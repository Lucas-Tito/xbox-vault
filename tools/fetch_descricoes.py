#!/usr/bin/env python3
"""Descricao dos jogos, do arquivo aberto x360db.

O catalogo so tem descricao nos 808 homebrews, escritos a mao. Os jogos de
verdade nao tem nenhuma, e o texto da loja e justamente o que diz do que o jogo
se trata para quem nunca ouviu falar dele.

A fonte e o info.json de cada titulo no x360db, no campo description.short.

POR QUE O "short" E NAO O "full": o full vem com entulho de loja antes da
descricao. O do Halo 3 abre com "In approximately ONE YEAR, in December 2021,
online services for legacy Halo Xbox 360 titles will be discontinued"; o do
Fallout 3 abre com "This game supports English"; o do Forza Horizon com "The
Games on Demand version supports French, Spanish, Portuguese, English. Download
the manual...". O short e so o texto do jogo.

Cobre no maximo os 4.892 jogos com Title ID, que sao 360 e XBLIG. Xbox original
nao tem Title ID e fica de fora; para esses a reserva seria a Wikipedia.

Resumivel: quem ja esta no arquivo nao e buscado de novo, a gravacao e atomica
e o checkpoint e a cada 50, entao queda de luz custa poucos segundos de trabalho.
"""
import concurrent.futures as cf
import json, os, sys, tempfile, threading, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INFO = "https://raw.githubusercontent.com/xenia-manager/x360db/HEAD/titles/%s/info.json"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
WORKERS = 5
MIN, MAX = 20, 1200      # descricao fora dessa faixa nao e descricao

lock = threading.Lock()
stat = {"ok": 0, "vazio": 0, "falha": 0}


def baixar(url, tries=3):
    delay = 1.5
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404 or n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.7
    return None


def salvar(caminho, obj):
    d = os.path.dirname(caminho)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=0, sort_keys=True)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, caminho)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def work(item):
    gid, tid = item
    raw = baixar(INFO % tid)
    if raw is None:
        with lock: stat["falha"] += 1
        return gid, None
    try:
        d = json.loads(raw).get("description") or {}
    except ValueError:
        with lock: stat["falha"] += 1
        return gid, None
    txt = (d.get("short") or "").strip()
    if not (MIN <= len(txt) <= MAX):
        with lock: stat["vazio"] += 1
        return gid, ""          # consultado e sem descricao util
    with lock: stat["ok"] += 1
    return gid, " ".join(txt.split())


def main():
    with open(os.path.join(ROOT, "data", "x360db.json"), encoding="utf-8") as f:
        base = json.load(f)
    saida = os.path.join(ROOT, "data", "descricoes.json")
    dados = {}
    if os.path.exists(saida) and "--refazer" not in sys.argv:
        with open(saida, encoding="utf-8") as f:
            dados = json.load(f)

    itens = [(gid, v["titleId"]) for gid, v in sorted(base.items())
             if v.get("titleId") and gid not in dados]
    limite = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0
    if limite:
        itens = itens[:limite]
    print("com Title ID: %d | ja feitos: %d | na fila: %d"
          % (len(base), len(dados), len(itens)))

    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        futs = [ex.submit(work, i) for i in itens]
        feito = 0
        for fut in cf.as_completed(futs):
            gid, txt = fut.result()
            if txt is not None:
                dados[gid] = txt
            feito += 1
            if feito % 50 == 0 or feito == len(itens):
                salvar(saida, dados)
                print("  %d/%d  com texto=%d sem=%d falha=%d  %.0f min"
                      % (feito, len(itens), stat["ok"], stat["vazio"], stat["falha"],
                         (time.time() - t0) / 60), flush=True)
    salvar(saida, dados)
    com = sum(1 for v in dados.values() if v)
    print("\ndata/descricoes.json: %d consultados, %d com descricao" % (len(dados), com))
    return 0


if __name__ == "__main__":
    sys.exit(main())
