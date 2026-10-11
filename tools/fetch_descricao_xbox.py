#!/usr/bin/env python3
"""Descricao dos jogos do Xbox original, do LaunchBox.

A do 360 vem do x360db pelo Title ID, e o x360db nao cobre o Xbox original.
O LaunchBox (cache/launchbox-metadata.zip, ja usado para capas) tem o Overview
de quase todos: texto de caixa ou de loja, o mais parecido com o do 360. Sem
rede. O casamento e o do launchboxlib.py, o mesmo do genero.

Parte dos textos e copia da abertura da Wikipedia, e vem com o que ela tem de
enciclopedia e nao de descricao, que sai aqui:
- o parentese com o nome em japones, as vezes com resto de transcricao
  ("Phantom Dust (ファントムダスト Fantomu Dasutu?) is a video game...");
- as marcas de nota ("[1]", "[citation needed]") e os titulos de secao ("Plot[edit]");
- as quebras de paragrafo, que a ficha juntaria de qualquer jeito.

O teto e o mesmo do 360, 1.200 caracteres; o que passa e cortado no fim da
ultima frase que cabe, em vez de jogado fora como la (la o texto curto e outro
campo da mesma loja; aqui nao ha versao curta).

Saida: data/descricoes-xbox.json, {id: texto}. O bundle.py so preenche quem
nao tem descricao.
"""
import collections
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402
import launchboxlib  # noqa: E402

SAIDA = os.path.join(ROOT, "data", "descricoes-xbox.json")
MIN, MAX = 20, 1200
JAPONES = re.compile(r"[　-ヿ㐀-鿿＀-￯]")


def limpa(txt):
    t = html.unescape(txt or "")
    t = " ".join(t.split())
    # parentese com japones some inteiro: o que sobra dentro dele e transcricao
    t = re.sub(r"\s*\([^()]*\)", lambda m: "" if JAPONES.search(m.group(0)) else m.group(0), t)
    t = re.sub(r"\[(\d+|citation needed|[a-z])\]", "", t)
    # titulo de secao copiado junto ("...Vietnam War. Plot[edit] Men of Valor")
    t = re.sub(r"(?<=[.!?])\s+[A-Z][^.!?\[\]]{0,40}\[edit\]", "", t)
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    t = re.sub(r",\s*,", ",", t)
    # "Shadow the Hedgehog (...) Is a 2005..." perde o parentese e fica o Is
    t = re.sub(r"(\w) Is (a|an|the) ", r"\1 is \2 ", t)
    t = " ".join(t.split())
    if len(t) > MAX:
        corte = max(t.rfind(". ", 0, MAX), t.rfind("! ", 0, MAX), t.rfind("? ", 0, MAX))
        t = t[:corte + 1] if corte > MIN else ""
    return t if len(t) >= MIN else ""


def main():
    games = json.load(open(os.path.join(ROOT, "data", "xbox.json"), encoding="utf-8"))
    print("jogos do Xbox original: %d" % len(games))
    pares, sem = launchboxlib.casar(games)
    como = collections.Counter({"sem par": sem})
    out = {}
    for gid, (d, via) in pares.items():
        t = limpa(d["resumo"])
        if not t:
            como["par sem texto"] += 1
            continue
        out[gid] = t
        como["pelo " + via] += 1
    print("LaunchBox: %s" % dict(como))
    print("com descricao: %d de %d" % (len(out), len(games)))
    jsonio.salvar(SAIDA, out)
    print("gravado %s" % os.path.relpath(SAIDA, ROOT))


if __name__ == "__main__":
    main()
