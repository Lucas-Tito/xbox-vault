#!/usr/bin/env python3
"""Baixa as capas dos XBLIG do Internet Archive e grava em images/ como WebP.

Mesmo pipeline dos outros (240px, WEBP q72), resumivel e idempotente.
"""
import concurrent.futures as cf
import io, json, os, sys, threading, time, urllib.error, urllib.parse, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
BASE = "https://archive.org/download/xbox-360-indie-games-rom/"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
WIDTH, QUALITY, WORKERS = 240, 72, 4

lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0, "bytes": 0}


def fetch(url, tries=4):
    delay = 2.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404 or n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.6
    return None


def work(item):
    gid, cover = item
    dest = os.path.join(OUT, gid + ".webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock:
            stat["skip"] += 1; stat["bytes"] += os.path.getsize(dest)
        return
    url = BASE + urllib.parse.quote(cover)
    raw = fetch(url)
    if not raw:
        with lock: stat["fail"] += 1
        return
    try:
        im = Image.open(io.BytesIO(raw))
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (28, 36, 46))
            im = im.convert("RGBA"); bg.paste(im, mask=im.split()[-1]); im = bg
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
    with open(os.path.join(ROOT, "data", "xblig.json"), encoding="utf-8") as f:
        jogos = json.load(f)
    itens = [(g["id"], g["iaCover"]) for g in jogos if g.get("iaCover")]
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limite:
        itens = itens[:limite]
    print("capas a processar: %d" % len(itens))
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, i) for i in itens]
        done = 0
        for _ in cf.as_completed(futs):
            done += 1
            if done % 200 == 0 or done == len(itens):
                print("  %d/%d  ok=%d pulados=%d falhas=%d  %.1f MB  %.0fs" %
                      (done, len(itens), stat["ok"], stat["skip"], stat["fail"],
                       stat["bytes"] / 1048576, time.time() - t0), flush=True)
    print("\nnovas %d | ja existiam %d | falhas %d | %.1f MB" %
          (stat["ok"], stat["skip"], stat["fail"], stat["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
