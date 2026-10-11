#!/usr/bin/env python3
"""Tamanho dos jogos do Xbox original, da lista de arquivos do disco no dbox.tools.

O tamanho do 360 e o download do Marketplace, e o Xbox original nao tinha loja.
O datfile do Redump tambem nao serve: 2.550 dos 2.559 discos de Xbox tem
exatamente 7.825.162.240 bytes, a imagem inteira com o enchimento.

O dbox.tools (API aberta, sem chave) lista os arquivos de cada disco do Redump,
com o tamanho de cada um. A soma e o conteudo do disco extraido: o espaco que o
jogo ocupa no HD do Xbox ou no xemu. Nao e tamanho de download.

Disco e jogo se ligam pelo Title ID, sem casar nome: o XMID do disco
("MS00409A") traz a editora em duas letras e o numero do jogo em decimal, e o
Title ID e o hexa das letras mais o numero em quatro digitos hexa:
MS + 004 = 4D53 + 0004 = 4D530004 (Halo). Entram todos os Title IDs do jogo,
o principal e os dos outros lancamentos.

O mesmo jogo da somas diferentes conforme a edicao do disco. O Halo americano
revisado traz videos do Halo 2 (3,63 GB, contra 2,02 do japones), e o Call of
Duty 2: Big Red One de colecionador tem 4,1 GB contra 3,2 do normal. Por isso a
escolha e fixa: categoria Games, regiao americana antes das outras, edicao
original antes de reedicao, sem revisao nem colecionador quando houver outro.
O disco escolhido vai junto no arquivo, para dar para conferir.

Cache em cache/dbox/: a lista de discos (26 requisicoes) e a lista de arquivos
de cada disco (uma requisicao por jogo, com pausa de 1 s). A segunda rodada nao
toca a rede, e uma rodada interrompida continua de onde parou.

Saida: data/tamanho-xbox.json, {id: {"gb": ..., "disco": nome do Redump}}.
"""
import collections
import json
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402

API = "https://dbox.tools/api"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
CACHE = os.path.join(ROOT, "cache", "dbox")
SAIDA = os.path.join(ROOT, "data", "tamanho-xbox.json")
GB = 1024 ** 3
REGIAO = ["USA", "World", "Europe", "Japan"]


def baixar(url, tentativas=4):
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            if i == tentativas - 1:
                raise
            print("   falhou (%s), tentando de novo" % e)
            time.sleep(5 * (i + 1))


def discos():
    caminho = os.path.join(CACHE, "discos.json")
    if os.path.exists(caminho):
        return json.load(open(caminho, encoding="utf-8"))
    todos, off = [], 0
    while True:
        d = baixar("%s/discs/?system=XBOX&limit=100&offset=%d" % (API, off))
        todos += d["items"]
        off += 100
        if off >= d["count"] or not d["items"]:
            break
        time.sleep(1)
    jsonio.salvar(caminho, todos)
    return todos


def arquivos(disco_id):
    """(lista de arquivos, se veio da rede). None quando o dbox nao responde: ha
    disco que da erro 500 sempre, e ai se tenta o proximo disco do mesmo jogo."""
    caminho = os.path.join(CACHE, "arquivos", "%d.json" % disco_id)
    if os.path.exists(caminho):
        return json.load(open(caminho, encoding="utf-8")), False
    try:
        lista = baixar("%s/discs/%d/files" % (API, disco_id))
    except Exception as e:  # noqa: BLE001
        print("   disco %d sem lista de arquivos (%s)" % (disco_id, e))
        return None, True
    jsonio.salvar(caminho, lista)
    return lista, True


def title_id(xmid):
    m = re.match(r"^([A-Z0-9]{2})(\d{3})", xmid or "")
    if not m:
        return None
    return "%02X%02X%04X" % (ord(m.group(1)[0]), ord(m.group(1)[1]), int(m.group(2)))


def ordem(d):
    """Menor e melhor: regiao americana, edicao original, sem revisao nem colecionador."""
    reg = d.get("redump_region") or ""
    nome = (d.get("redump_datname") or "") + " " + (d.get("redump_edition") or "")
    r = min([REGIAO.index(x) for x in REGIAO if x in reg] or [len(REGIAO)])
    return (r,
            (d.get("redump_edition") or "") != "Original",
            "(Rev" in nome,
            bool(re.search(r"collector|limited|special", nome, re.I)),
            d["id"])


def main():
    os.makedirs(os.path.join(CACHE, "arquivos"), exist_ok=True)
    games = json.load(open(os.path.join(ROOT, "data", "xbox.json"), encoding="utf-8"))
    xemu = json.load(open(os.path.join(ROOT, "data", "xemu.json"), encoding="utf-8"))
    por_tid = collections.defaultdict(list)
    for d in discos():
        if d.get("redump_category") == "Games":
            por_tid[title_id(d.get("xmid"))].append(d)
    print("discos de jogo no dbox: %d" % sum(len(v) for v in por_tid.values()))

    out, como, baixados = {}, collections.Counter(), 0
    for g in games:
        xe = xemu.get(g["id"]) or {}
        tids = [t.upper() for t in [xe.get("titleId")] + (xe.get("outros") or []) if t]
        if not tids:
            como["sem Title ID"] += 1
            continue
        cands = sorted({d["id"]: d for t in tids for d in por_tid.get(t, [])}.values(), key=ordem)
        if not cands:
            como["sem disco"] += 1
            continue
        soma = 0
        for d in cands:
            lista, novo = arquivos(d["id"])
            if novo:
                baixados += 1
                if baixados % 50 == 0:
                    print("   %d discos baixados" % baixados)
                time.sleep(1)
            soma = sum(x.get("size") or 0 for x in lista or [])
            if soma:
                break
        if not soma:
            como["disco sem arquivos"] += 1
            continue
        out[g["id"]] = {"gb": round(soma / GB, 3), "disco": d.get("redump_datname")}
        como["com tamanho"] += 1
    print(dict(como))
    jsonio.salvar(SAIDA, out)
    print("gravado %s (%d jogos; %d discos baixados agora)" % (os.path.relpath(SAIDA, ROOT), len(out), baixados))


if __name__ == "__main__":
    main()
