#!/usr/bin/env python3
"""Title ID do Xbox original, do banco de jogos do xemu.

O xemu (emulador do Xbox original) mantem o xdb, github.com/xemu-project/xdb:
uma pasta por jogo com um info.json que traz o nome, o Title ID e um Title ID
por lancamento (regiao, edicao, disco). O x360db, de onde sai o do 360, nao
cobre o Xbox original.

O Title ID e o que o CollectionUI grava no colecoes.txt, e a FreeStyle le o do
disco que estiver no console, de qualquer regiao. Por isso guardamos TODOS: o
principal e os dos outros lancamentos, em "outros".

O site do xemu publica um compat.json com nome e Title ID num arquivo so, mas
sem os lancamentos regionais, e eles fazem falta: o Marvel Nemesis de um
console real so casa pelo ID de uma das regioes. Entao vao os 1.024 info.json,
baixados em paralelo e guardados em cache/xdb/, o que deixa a segunda rodada
instantanea.

O casamento de nome com o catalogo e o mesmo do x360db (titlelib.py).
"""
import concurrent.futures
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402
import titlelib  # noqa: E402

ARVORE = "https://api.github.com/repos/xemu-project/xdb/git/trees/main?recursive=1"
CRU = "https://raw.githubusercontent.com/xemu-project/xdb/main/"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
CACHE = os.path.join(ROOT, "cache", "xdb")


def baixar(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def info(caminho):
    """O info.json de um jogo, do cache ou da rede."""
    local = os.path.join(CACHE, caminho)
    if not os.path.exists(local):
        dado = baixar(CRU + caminho)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, "wb") as f:
            f.write(dado)
    with open(local, encoding="utf-8") as f:
        return json.load(f)


def main():
    lista = os.path.join(CACHE, "arvore.json")
    if os.path.exists(lista) and "--refazer" not in sys.argv:
        caminhos = json.load(open(lista, encoding="utf-8"))
    else:
        arvore = json.loads(baixar(ARVORE))
        if arvore.get("truncated"):
            sys.exit("a listagem do xdb veio truncada; nada foi gravado")
        caminhos = sorted(t["path"] for t in arvore["tree"]
                          if t["path"].startswith("titles/") and t["path"].endswith("/info.json"))
        os.makedirs(CACHE, exist_ok=True)
        with open(lista, "w", encoding="utf-8") as f:
            json.dump(caminhos, f)
    print("xdb: %d jogos" % len(caminhos))

    with concurrent.futures.ThreadPoolExecutor(16) as ex:
        infos = list(ex.map(info, caminhos))

    catalogo = [(g["id"], g["title"], g.get("year"))
                for g in json.load(open(os.path.join(ROOT, "data", "xbox.json"), encoding="utf-8"))]
    casados = titlelib.casar([(k, i.get("name")) for k, i in enumerate(infos)], catalogo)

    out = {}
    for gid, (chaves, modo) in casados.items():
        principal = infos[chaves[0]]["title_id"].upper()
        outros = set()
        for k in chaves:
            outros.add(infos[k]["title_id"].upper())
            outros.update(r["title_id"].upper() for r in infos[k].get("releases") or [] if r.get("title_id"))
        outros.discard(principal)
        reg = {"titleId": principal}
        if outros:
            reg["outros"] = sorted(outros)
        if modo == "aprox":
            reg["aprox"] = True       # casado pelo nome curto, nao pelo nome igual
        out[gid] = reg

    saida = os.path.join(ROOT, "data", "xemu.json")
    jsonio.salvar(saida, out)
    print("casaram %d de %d jogos do Xbox original (%d pelo nome curto, %d com Title ID alternativo)"
          % (len(out), len(catalogo), sum(1 for v in out.values() if v.get("aprox")),
             sum(1 for v in out.values() if v.get("outros"))))
    print("-> data/xemu.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
