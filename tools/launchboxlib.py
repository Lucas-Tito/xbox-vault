"""Os jogos de Xbox original do dump do LaunchBox, casados com o catalogo.

O dump (cache/launchbox-metadata.zip) ja e usado para capas. O genero e a
descricao do Xbox original saem dele tambem, e os dois precisam do MESMO
casamento, por isso ele mora aqui.

O casamento comeca pelo NOME (o do LaunchBox e os nomes alternativos dele), e
so recorre ao link da Wikipedia quando o artigo e de um jogo so do catalogo:
artigo de serie (LMA Manager 2003 a 2006 num artigo so) daria o texto de um
jogo para todos. Nome que serve para mais de um jogo do LaunchBox fica de fora.
"""
import collections
import os
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

import titlelib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = os.path.join(ROOT, "cache", "launchbox-metadata.zip")


def wiki_chave(u):
    if not u:
        return None
    u = urllib.parse.unquote(u.split("/wiki/")[-1]).replace("_", " ").split("#")[0]
    return u.strip().lower() or None


def ler_xbox():
    """{DatabaseID: {nome, generos, resumo, wiki}} e {DatabaseID: [nomes alternativos]}."""
    jogos, alternativos = {}, collections.defaultdict(list)
    with zipfile.ZipFile(DUMP).open("Metadata.xml") as f:
        for _, el in ET.iterparse(f):
            if el.tag == "Game":
                if el.findtext("Platform") == "Microsoft Xbox":
                    jogos[el.findtext("DatabaseID")] = {
                        "nome": el.findtext("Name") or "",
                        "generos": el.findtext("Genres") or "",
                        "resumo": el.findtext("Overview") or "",
                        "wiki": wiki_chave(el.findtext("WikipediaURL")),
                    }
                el.clear()
            elif el.tag == "GameAlternateName":
                alternativos[el.findtext("DatabaseID")].append(el.findtext("AlternateName") or "")
                el.clear()
    return jogos, alternativos


def casar(games, so=None):
    """{id do catalogo: (jogo do LaunchBox, "nome" | "link")} e quantos ficaram sem par.
    games e o catalogo INTEIRO, que e onde se ve se um artigo e de um jogo so;
    so, se vier, limita a quem se procura par."""
    lb, alt = ler_xbox()
    por_nome = collections.defaultdict(set)
    por_wiki = collections.defaultdict(set)
    for k, d in lb.items():
        for n in [d["nome"]] + alt.get(k, []):
            por_nome[titlelib.norm(n)].add(k)
        if d["wiki"]:
            por_wiki[d["wiki"]].add(k)
    # artigo de um jogo so: o link aparece em um jogo do catalogo
    uso_wiki = collections.Counter(wiki_chave(g.get("wiki")) for g in games if g.get("wiki"))
    out, sem = {}, 0
    for g in games:
        if so is not None and g["id"] not in so:
            continue
        cands, via = por_nome.get(titlelib.norm(g["title"]), set()), "nome"
        if len(cands) != 1:
            wk = wiki_chave(g.get("wiki"))
            cands = por_wiki.get(wk, set()) if wk and uso_wiki[wk] == 1 else set()
            via = "link"
        if len(cands) == 1:
            out[g["id"]] = (lb[next(iter(cands))], via)
        else:
            sem += 1
    return out, sem
