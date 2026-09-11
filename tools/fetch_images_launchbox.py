#!/usr/bin/env python3
"""Completa as capas que faltam usando o LaunchBox Games Database.

A Wikipedia nao tem imagem para ~280 titulos do catalogo (lancamentos so no Japao,
shovelware, jogos sem artigo). O LaunchBox publica um dump de metadados aberto,
sem chave de API, com box art de console.

Uso:
    python3 tools/fetch_images_launchbox.py --dry-run   # so mede o casamento
    python3 tools/fetch_images_launchbox.py             # baixa de verdade

O dump (107 MB) fica em cache/ e nao entra no repo.
"""
import argparse, collections, io, json, os, re, subprocess, sys, threading, time
import concurrent.futures as cf
import unicodedata, urllib.request, urllib.error, zipfile
import xml.etree.ElementTree as ET

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
CACHE = os.path.join(ROOT, "cache")
DUMP = os.path.join(CACHE, "launchbox-metadata.zip")
DUMP_URL = "https://gamesdb.launchbox-app.com/Metadata.zip"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
IMG_BASE = "https://images.launchbox-app.com/"
WIDTH, QUALITY, WORKERS = 240, 72, 4

PLAT = {"x360": "Microsoft Xbox 360", "xbox": "Microsoft Xbox"}
# Regiao preferida quando ha varias capas do mesmo jogo
REGION_RANK = {"North America": 0, "United States": 1, "World": 2, "Europe": 3, "": 4}

lock = threading.Lock()
stat = collections.Counter()


def norm(s):
    """Normaliza titulo para casar entre bases: sem acento, sem pontuacao, sem artigo."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", " and ")
    s = re.sub(r"\b(the|a|an)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def ensure_dump():
    if os.path.exists(DUMP) and os.path.getsize(DUMP) > 10_000_000:
        return
    os.makedirs(CACHE, exist_ok=True)
    print("baixando o dump do LaunchBox (107 MB, so na primeira vez)...")
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=900) as r, open(DUMP + ".tmp", "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(DUMP + ".tmp", DUMP)


def load_index():
    """{plataforma: {titulo_normalizado: FileName da capa}} a partir do dump."""
    ensure_dump()
    games, alts, images = {}, collections.defaultdict(list), collections.defaultdict(list)
    want = set(PLAT.values())
    targets = {"Game", "GameImage", "GameAlternateName"}
    with zipfile.ZipFile(DUMP).open("Metadata.xml") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag not in targets:
                continue
            d = {c.tag: (c.text or "") for c in el}
            if el.tag == "Game":
                if d.get("Platform", "") in want:
                    games[d.get("DatabaseID", "")] = (d.get("Name", ""), d["Platform"])
            elif el.tag == "GameAlternateName":
                alts[d.get("DatabaseID", "")].append(d.get("AlternateName", ""))
            elif el.tag == "GameImage":
                if d.get("Type") == "Box - Front":
                    images[d.get("DatabaseID", "")].append(
                        (REGION_RANK.get(d.get("Region", ""), 5), d.get("FileName", "")))
            el.clear()

    idx = {k: {} for k in PLAT}
    inv = {v: k for k, v in PLAT.items()}
    for dbid, (name, plat) in games.items():
        if dbid not in images:
            continue
        best = sorted(images[dbid])[0][1]
        bucket = idx[inv[plat]]
        for cand in [name] + alts.get(dbid, []):
            k = norm(cand)
            if k and k not in bucket:
                bucket[k] = best
    return idx


def missing_games():
    js = ("global.window={};require(%r);"
          "console.log(JSON.stringify(window.XBX_DB.games.filter(g=>!g.image)"
          ".map(g=>({id:g.id,title:g.title,platform:g.platform}))));"
          % os.path.join(ROOT, "data", "db.js"))
    return json.loads(subprocess.run(["node", "-e", js], capture_output=True,
                                     text=True, check=True).stdout)


def fetch(url, tries=4):
    delay = 2.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.6
    return None


def work(job):
    gid, url = job
    dest = os.path.join(OUT, gid + ".webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock: stat["skip"] += 1
        return
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="so reporta o casamento")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    print("lendo o dump do LaunchBox...")
    idx = load_index()
    print("  indice: " + ", ".join("%s=%d titulos" % (k, len(v)) for k, v in idx.items()))

    miss = missing_games()
    print("jogos sem capa no catalogo: %d" % len(miss))

    jobs, unmatched = [], collections.Counter()
    for g in miss:
        bucket = idx.get(g["platform"])
        if not bucket:                      # homebrew nao existe no LaunchBox
            unmatched[g["platform"]] += 1
            continue
        fn = bucket.get(norm(g["title"]))
        if fn:
            jobs.append((g["id"], IMG_BASE + fn))
        else:
            unmatched[g["platform"]] += 1

    print("  casaram: %d" % len(jobs))
    for p, c in sorted(unmatched.items()):
        print("  sem correspondencia em %-9s %d" % (p, c))
    if args.dry_run:
        for gid, url in jobs[:10]:
            print("    %-52s %s" % (gid, url))
        return 0

    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        done = 0
        for _ in cf.as_completed(futs):
            done += 1
            if done % 50 == 0 or done == len(jobs):
                print("  %d/%d  ok=%d pulados=%d falhas=%d  %.1f MB  %.0fs" %
                      (done, len(jobs), stat["ok"], stat["skip"], stat["fail"],
                       stat["bytes"] / 1048576, time.time() - t0), flush=True)
    print("\nnovas capas: %d | falhas: %d | +%.1f MB" %
          (stat["ok"], stat["fail"], stat["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
