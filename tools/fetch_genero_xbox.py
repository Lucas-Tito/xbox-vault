#!/usr/bin/env python3
"""Genero dos jogos do Xbox original, da Wikipedia e, na falta, do LaunchBox.

O genero do 360 vem da coluna de genero da lista da Wikipedia. A lista do Xbox
original nao tem essa coluna, e nenhum dos 995 jogos tinha genero.

1. Wikipedia: o campo genre da infobox do artigo do jogo. E o mesmo wikitext
   que o tag_xbox.py ja baixa (e guarda em cache/), pedido na mesma ordem, entao
   a rodada quase nao toca a rede. Mesmo estilo do 360: "First-person shooter",
   "Platform, action-adventure".
2. LaunchBox (cache/launchbox-metadata.zip), para quem ficou sem: o primeiro
   dos Genres, num vocabulario mais grosso ("Shooter" onde a Wikipedia diria
   "First-person shooter"), por isso so entra depois.

O casamento com o LaunchBox comeca pelo NOME, e so recorre ao link da Wikipedia
quando o artigo e de um jogo so: artigo de serie (LMA Manager 2003 a 2006 num
artigo) daria o genero de um jogo para todos.

Saida: data/genero-xbox.json, {id: {"genero": ..., "fonte": "wikipedia" | "launchbox"}}.
O bundle.py so preenche o genre de quem nao tem.
"""
import collections
import json
import os
import re
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402
import taglib as t  # noqa: E402
import titlelib  # noqa: E402
import wikilib as w  # noqa: E402

LB = os.path.join(ROOT, "cache", "launchbox-metadata.zip")
SAIDA = os.path.join(ROOT, "data", "genero-xbox.json")


# "Board game" e "Card game" sao o nome do genero; nos outros, "game" sobra.
COM_GAME = {"board game", "card game", "party game"}


def limpa_wiki(g):
    """O genero da infobox no formato do filtro, que agrupa por texto igual.
    - "Sports (baseball)", "Sports game" e "Sports video game" viram "Sports";
    - a lista com marcador ("* Rhythm * Music") vira "Rhythm, music";
    - "Various" (coletanea) nao e genero, e o jogo cai para o LaunchBox."""
    g = re.sub(r"\s*\([^)]*\)", "", g or "")
    partes, vistas = [], set()
    for p in re.split(r"\s*[,*;]\s*", g):
        p = p.strip()
        if p.lower() in COM_GAME:
            p = p.capitalize()          # "Board Game" e "Board game" sao um so
        else:
            p = re.sub(r"\s+(video\s+)?game$", "", p, flags=re.I)
        if p and p.lower() not in vistas:
            vistas.add(p.lower())
            partes.append(p)
    g = ", ".join(partes)
    if g.lower() in ("various", "multiple", "compilation", ""):
        return None
    return g[0].upper() + g[1:]


def wiki_chave(u):
    if not u:
        return None
    u = urllib.parse.unquote(u.split("/wiki/")[-1]).replace("_", " ").split("#")[0]
    return u.strip().lower() or None


def ler_launchbox():
    jogos, alternativos = {}, collections.defaultdict(list)
    with zipfile.ZipFile(LB).open("Metadata.xml") as f:
        for _, el in ET.iterparse(f):
            if el.tag == "Game":
                if el.findtext("Platform") == "Microsoft Xbox":
                    jogos[el.findtext("DatabaseID")] = {
                        "nome": el.findtext("Name") or "",
                        "generos": el.findtext("Genres") or "",
                        "wiki": wiki_chave(el.findtext("WikipediaURL")),
                    }
                el.clear()
            elif el.tag == "GameAlternateName":
                alternativos[el.findtext("DatabaseID")].append(el.findtext("AlternateName") or "")
                el.clear()
    return jogos, alternativos


def main():
    games = json.load(open(os.path.join(ROOT, "data", "xbox.json"), encoding="utf-8"))
    print("jogos do Xbox original: %d" % len(games))

    # mesma lista e mesma ordem do tag_xbox.py: os lotes de 50 batem com o cache
    wikis = [g["wiki"] for g in games if g.get("wiki")]
    textos = w.batch_wikitext(wikis)
    print("artigos com wikitext: %d de %d" % (len(textos), len(wikis)))

    out = {}
    for g in games:
        wt = textos.get(g.get("wiki"))
        gen = limpa_wiki(t._plain(t.extract_infobox(wt).get("genre", ""))) if wt else None
        if gen:
            out[g["id"]] = {"genero": gen, "fonte": "wikipedia"}
    print("genero pela Wikipedia: %d" % len(out))

    lb, alt = ler_launchbox()
    print("jogos de Xbox no LaunchBox: %d" % len(lb))
    por_nome = collections.defaultdict(set)
    por_wiki = collections.defaultdict(set)
    for k, d in lb.items():
        for n in [d["nome"]] + alt.get(k, []):
            por_nome[titlelib.norm(n)].add(k)
        if d["wiki"]:
            por_wiki[d["wiki"]].add(k)
    # artigo de um jogo so: o link aparece em um jogo do catalogo
    uso_wiki = collections.Counter(wiki_chave(g.get("wiki")) for g in games if g.get("wiki"))

    como = collections.Counter()
    for g in games:
        if g["id"] in out:
            continue
        cands = por_nome.get(titlelib.norm(g["title"]), set())
        if len(cands) != 1:
            wk = wiki_chave(g.get("wiki"))
            cands = por_wiki.get(wk, set()) if wk and uso_wiki[wk] == 1 else set()
            via = "link"
        else:
            via = "nome"
        if len(cands) != 1:
            como["sem par"] += 1
            continue
        primeiro = lb[next(iter(cands))]["generos"].split(";")[0].strip()
        if primeiro.lower() in COM_GAME:
            primeiro = primeiro.capitalize()
        if not primeiro:
            como["par sem genero"] += 1
            continue
        out[g["id"]] = {"genero": primeiro, "fonte": "launchbox"}
        como["launchbox pelo " + via] += 1
    print("LaunchBox: %s" % dict(como))
    print("com genero: %d de %d" % (len(out), len(games)))
    jsonio.salvar(SAIDA, out)
    print("gravado %s" % os.path.relpath(SAIDA, ROOT))


if __name__ == "__main__":
    main()
