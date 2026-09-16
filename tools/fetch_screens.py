#!/usr/bin/env python3
"""Baixa screenshots de gameplay do Marketplace e grava em images/screens/.

O x360db guarda, por titulo, a galeria que aparecia na pagina da loja: de 6 a 20
capturas de 1000x562. O servidor original (download.xbox.com) continua no ar
servindo essas imagens mesmo com o Marketplace fechado desde 2024.

Orcamento de peso: 3 por jogo, 480px de largura, WEBP q70. O WebP derruba cada
uma de ~188 KB para ~10 KB, entao os ~4.900 jogos custam cerca de 150 MB. Elas
so aparecem no popup, e o popup so e montado no clique -- quem nunca abrir uma
ficha nao baixa nenhuma.

Resumivel e idempotente: quem ja tem as imagens em disco nem tem o info.json
buscado de novo.
"""
import concurrent.futures as cf
import io, json, os, sys, threading, time, urllib.error, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402
OUT = os.path.join(ROOT, "images", "screens")
INFO = "https://raw.githubusercontent.com/xenia-manager/x360db/HEAD/titles/%s/info.json"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
POR_JOGO, LARGURA, QUALIDADE, WORKERS = 3, 480, 70, 5

lock = threading.Lock()
stat = {"ok": 0, "pulados": 0, "sem_galeria": 0, "falhas": 0, "imgs": 0, "bytes": 0}


def baixar(url, tries=3):
    delay = 1.5
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 403) or n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.7
    return None


def salvar(raw, dest):
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.width > LARGURA:
        im = im.resize((LARGURA, max(1, round(im.height * LARGURA / im.width))), Image.LANCZOS)
    tmp = dest + ".tmp"
    im.save(tmp, "WEBP", quality=QUALIDADE, method=6)
    os.replace(tmp, dest)
    return os.path.getsize(dest)


def work(item):
    gid, tid = item
    já = [n for n in range(1, POR_JOGO + 1)
          if os.path.exists(os.path.join(OUT, "%s-%d.webp" % (gid, n)))]
    if len(já) == POR_JOGO:
        with lock:
            stat["pulados"] += 1
        return gid, POR_JOGO

    raw = baixar(INFO % tid)
    if not raw:
        with lock: stat["falhas"] += 1
        return gid, 0
    try:
        galeria = (json.loads(raw.decode("utf-8")).get("artwork") or {}).get("gallery") or []
    except ValueError:
        with lock: stat["falhas"] += 1
        return gid, 0
    if not galeria:
        with lock: stat["sem_galeria"] += 1
        return gid, 0

    n = 0
    for url in galeria[:POR_JOGO]:
        dest = os.path.join(OUT, "%s-%d.webp" % (gid, n + 1))
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            n += 1
            continue
        img = baixar(url)
        if not img:
            continue
        try:
            b = salvar(img, dest)
            n += 1
            with lock:
                stat["imgs"] += 1; stat["bytes"] += b
        except Exception:
            pass
    with lock:
        if n:
            stat["ok"] += 1
        else:
            stat["falhas"] += 1
    return gid, n


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(ROOT, "data", "x360db.json"), encoding="utf-8") as f:
        base = json.load(f)
    itens = [(gid, v["titleId"]) for gid, v in sorted(base.items()) if v.get("titleId")]
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limite:
        itens = itens[:limite]

    saida = os.path.join(ROOT, "data", "screens.json")
    contagem = {}
    if os.path.exists(saida):
        with open(saida, encoding="utf-8") as f:
            contagem = json.load(f)

    print("jogos com Title ID: %d" % len(itens))
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, i) for i in itens]
        feito = 0
        for fut in cf.as_completed(futs):
            gid, n = fut.result()
            if n:
                contagem[gid] = n
            feito += 1
            if feito % 100 == 0 or feito == len(itens):
                jsonio.salvar(saida, contagem, indent=0, ensure_ascii=True)
                print("  %d/%d  jogos=%d pulados=%d sem-galeria=%d falhas=%d | "
                      "%d imgs, %.0f MB | %.0f min"
                      % (feito, len(itens), stat["ok"], stat["pulados"], stat["sem_galeria"],
                         stat["falhas"], stat["imgs"], stat["bytes"] / 1048576,
                         (time.time() - t0) / 60), flush=True)
    jsonio.salvar(saida, contagem, indent=0, ensure_ascii=True)
    print("\n%d jogos com screenshot | %d imagens | %.0f MB"
          % (len(contagem), stat["imgs"], stat["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
