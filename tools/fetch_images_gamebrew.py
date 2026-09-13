#!/usr/bin/env python3
"""Baixa as capturas de tela dos homebrews catalogados no GameBrew.

O GameBrew e um MediaWiki e expoe a mesma API da Wikipedia, entao da para pedir
a imagem principal de ate 50 paginas por requisicao (prop=pageimages). Cada
verbete traz uma captura do programa rodando, feita por quem catalogou -- que e
justamente o que falta para os ports e jogos homebrew.

Nao cobre as ferramentas de linha de comando de proposito: elas nao tem arte
nenhuma, e o placeholder do site diz mais do que um card gerado diria.

Mesmo pipeline dos outros (240px, WEBP q72), resumivel e idempotente.
"""
import concurrent.futures as cf
import io, json, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
API = "https://www.gamebrew.org/api.php"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
WIDTH, QUALITY, WORKERS = 240, 72, 3
LOTE = 50          # teto do pageimages por requisicao

lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0, "sem_imagem": 0, "bytes": 0}


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


def titulo_da_url(u):
    """https://www.gamebrew.org/wiki/Asteroids_Xbox -> Asteroids_Xbox"""
    m = re.match(r"https?://(?:www\.)?gamebrew\.org/wiki/([^#?]+)", u or "")
    return urllib.parse.unquote(m.group(1)) if m else None


def imagens_do_lote(titulos):
    """Devolve {titulo normalizado -> url da imagem} para ate LOTE paginas."""
    p = {"action": "query", "prop": "pageimages", "titles": "|".join(titulos),
         "pithumbsize": "480", "pilimit": str(LOTE), "pilicense": "any",
         "format": "json", "formatversion": "2"}
    raw = fetch(API + "?" + urllib.parse.urlencode(p))
    if not raw:
        return {}
    try:
        d = json.loads(raw.decode("utf-8"))
    except ValueError:
        return {}
    # a API normaliza "Baku_Baku_X_Xbox" para "Baku Baku X Xbox"; mapear de volta
    norm = {n["to"]: n["from"] for n in d.get("query", {}).get("normalized", [])}
    out = {}
    for pg in d.get("query", {}).get("pages", []):
        t = pg.get("title", "")
        src = (pg.get("thumbnail") or {}).get("source")
        if src:
            out[norm.get(t, t)] = src
    return out


def work(item):
    gid, url = item
    dest = os.path.join(OUT, gid + ".webp")
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
    with open(os.path.join(ROOT, "data", "homebrew.json"), encoding="utf-8") as f:
        hb = json.load(f)

    alvos = {}
    for g in hb:
        t = titulo_da_url(g.get("url"))
        if not t:
            continue
        dest = os.path.join(OUT, g["id"] + ".webp")
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            stat["skip"] += 1
            continue
        alvos[t] = g["id"]
    print("no GameBrew e ainda sem capa: %d (ja tinham: %d)" % (len(alvos), stat["skip"]))
    if not alvos:
        return 0

    titulos = sorted(alvos)
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limite:
        titulos = titulos[:limite]

    baixar = []
    for i in range(0, len(titulos), LOTE):
        lote = titulos[i:i + LOTE]
        achadas = imagens_do_lote(lote)
        for t in lote:
            if t in achadas:
                baixar.append((alvos[t], achadas[t]))
            else:
                stat["sem_imagem"] += 1
        print("  consultei %d/%d paginas | com imagem: %d"
              % (min(i + LOTE, len(titulos)), len(titulos), len(baixar)), flush=True)
        time.sleep(1.0)

    print("baixando %d imagens" % len(baixar))
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, b) for b in baixar]
        done = 0
        for _ in cf.as_completed(futs):
            done += 1
            if done % 25 == 0 or done == len(baixar):
                print("  %d/%d  ok=%d falhas=%d  %.1f MB  %.0fs" %
                      (done, len(baixar), stat["ok"], stat["fail"],
                       stat["bytes"] / 1048576, time.time() - t0), flush=True)
    print("\nnovas %d | sem imagem no wiki %d | falhas %d | %.1f MB" %
          (stat["ok"], stat["sem_imagem"], stat["fail"], stat["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
