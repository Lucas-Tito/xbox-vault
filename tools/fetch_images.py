#!/usr/bin/env python3
"""Baixa as capas da Wikimedia e guarda como WebP comprimido em images/.

Deixar as imagens no repo evita depender de hotlink para o upload.wikimedia.org
(que aplica rate-limit e pode mudar de estrutura).

Resumivel: pula o que ja existe, entao da para interromper e rodar de novo.
Idempotente: rodar duas vezes nao rebaixa nada.
"""
import concurrent.futures as cf
import io, json, os, subprocess, sys, threading, time, urllib.error, urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
WIDTH, QUALITY, WORKERS = 240, 72, 4
UA = ("XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com) "
      "Python-urllib")

lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0}


def source_list():
    """Le data/db.js pelo node para pegar id + URL remota de cada capa."""
    js = ("global.window={};require(%r);"
          "console.log(JSON.stringify(window.XBX_DB.games"
          ".filter(g=>g.imageRemote||g.image)"
          ".map(g=>[g.id, g.imageRemote||g.image])"
          ".filter(p=>/^https?:/.test(p[1]))));" % os.path.join(ROOT, "data", "db.js"))
    out = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def fetch(url, tries=5):
    delay = 2.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 503, 502, 500) and n < tries - 1:
                time.sleep(delay); delay *= 2; continue
            if e.code == 404:
                return None
            if n == tries - 1:
                return None
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.6
    return None


def work(item):
    gid, url = item
    dest = os.path.join(OUT, gid + ".webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock:
            stat["skip"] += 1; stat["bytes"] += os.path.getsize(dest)
        return
    raw = fetch(url)
    if not raw:
        with lock: stat["fail"] += 1
        return
    try:
        im = Image.open(io.BytesIO(raw))
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (28, 36, 46))
            im = im.convert("RGBA")
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        if im.width > WIDTH:
            im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
        tmp = dest + ".tmp"
        im.save(tmp, "WEBP", quality=QUALITY, method=6)
        os.replace(tmp, dest)
        with lock:
            stat["ok"] += 1; stat["bytes"] += os.path.getsize(dest)
    except Exception:
        with lock: stat["fail"] += 1


def main():
    os.makedirs(OUT, exist_ok=True)
    items = source_list()
    print("capas a processar: %d" % len(items))
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, it) for it in items]
        done = 0
        for _ in cf.as_completed(futs):
            done += 1
            if done % 200 == 0 or done == len(items):
                el = time.time() - t0
                print("  %d/%d  ok=%d pulados=%d falhas=%d  %.1f MB  %.0fs" %
                      (done, len(items), stat["ok"], stat["skip"], stat["fail"],
                       stat["bytes"] / 1048576, el), flush=True)
    print("\nbaixadas %d | ja existiam %d | falhas %d" % (stat["ok"], stat["skip"], stat["fail"]))
    print("total em disco: %.1f MB (largura %dpx, webp q%d)" %
          (stat["bytes"] / 1048576, WIDTH, QUALITY))
    return 0


if __name__ == "__main__":
    sys.exit(main())
