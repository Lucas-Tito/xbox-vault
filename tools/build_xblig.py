#!/usr/bin/env python3
"""Monta o catalogo dos Xbox Live Indie Games (XBLIG).

A lista da Wikipedia NAO inclui XBLIG -- por isso o filtro "Indie" nascia vazio.
Os titulos vem dos nomes das capas de um item do Internet Archive (3.451 jogos),
e ano/genero/estudio vem do dump aberto do LaunchBox, que cobre 92% deles.

Os ids usam o prefixo "xblig-", entao nao colidem com nada do catalogo existente
e arquivos de colecao exportados antes continuam validos.
"""
import json, os, re, sys, unicodedata, urllib.request, zipfile
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
IA_ITEM = "xbox-360-indie-games-rom"
IA_META = os.path.join(CACHE, "ia-xblig.json")
LB_DUMP = os.path.join(CACHE, "launchbox-metadata.zip")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
ANO_MIN, ANO_MAX = 2008, 2017          # janela real do programa XBLIG


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", " and ")
    s = re.sub(r"\b(the|a|an)\b", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def slug(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-") or "sem-titulo"


def ia_metadata():
    if not os.path.exists(IA_META):
        os.makedirs(CACHE, exist_ok=True)
        req = urllib.request.Request("https://archive.org/metadata/" + IA_ITEM,
                                     headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=180) as r, open(IA_META, "wb") as f:
            f.write(r.read())
    with open(IA_META) as f:
        return json.load(f)


def launchbox_360():
    """{titulo_normalizado: (nome, data, generos, dev, pub)} dos jogos de Xbox 360."""
    out = {}
    with zipfile.ZipFile(LB_DUMP).open("Metadata.xml") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag != "Game":
                continue                      # nao limpar filhos antes de ler o pai
            d = {c.tag: (c.text or "") for c in el}
            if d.get("Platform") == "Microsoft Xbox 360":
                k = norm(d.get("Name", ""))
                if k and k not in out:
                    out[k] = (d.get("Name", ""), d.get("ReleaseDate", ""),
                              d.get("Genres", ""), d.get("Developer", ""),
                              d.get("Publisher", ""))
            el.clear()
    return out


# Palavras no titulo que denunciam multiplayer. Sinal fraco, mas para XBLIG nao
# existe fonte estruturada nenhuma -- por isso tudo aqui sai confidence "low".
RE_LOCAL = re.compile(r"\b(\d)\s*p(?:layer)?\b|\bfour player\b|\btwo player\b|\bparty\b|\bcouch\b", re.I)
RE_VS = re.compile(r"\bvs\.?\b|\bversus\b|deathmatch|\bduel\b|\bfight\b|\barena\b|\bbattle\b", re.I)
RE_COOP = re.compile(r"co-?op", re.I)
RE_ONLINE = re.compile(r"\bonline\b|\blive\b|multiplayer", re.I)


def tags_do_titulo(t):
    loc = bool(RE_LOCAL.search(t))
    vs = bool(RE_VS.search(t))
    coop = bool(RE_COOP.search(t))
    onl = bool(RE_ONLINE.search(t))
    n = 0
    m = re.search(r"\b(\d)\s*p(?:layer)?\b", t, re.I)
    if m:
        n = int(m.group(1))
        if not (2 <= n <= 4):
            n = 0
    multi = loc or vs or coop or onl
    return {
        "singlePlayer": True,
        "multiplayerLocal": bool(multi and not (onl and not loc and not vs and not coop)),
        "multiplayerOnline": bool(onl),
        "coop": coop, "coopLocal": coop and loc, "coopOnline": coop and onl,
        "versus": bool(vs or (multi and not coop)), "versusLocal": bool(vs and loc),
        "maxPlayersLocal": n, "maxPlayersOnline": 0, "maxPlayers": n,
        "source": "title-hint" if multi else "xblig-default",
        "confidence": "low",
    }


def main():
    ia = ia_metadata()
    capas = [f["name"] for f in ia.get("files", [])
             if f["name"].startswith("Cover/") and f["name"].lower().endswith(".jpg")]
    print("capas no Internet Archive: %d" % len(capas))

    lb = launchbox_360()
    print("jogos de Xbox 360 no LaunchBox: %d" % len(lb))

    jogos, tags, usados = [], {}, {}
    com_ano = com_genero = 0
    for caminho in sorted(capas):
        titulo = caminho[len("Cover/"):-4]
        if titulo.strip() in ("#indie",):        # arte do proprio pacote, nao e jogo
            continue
        base = "xblig-" + slug(titulo)
        gid, n = base, 2
        while gid in usados:                     # garante unicidade
            gid = "%s-%d" % (base, n); n += 1
        usados[gid] = True

        g = lb.get(norm(titulo))
        ano = None
        if g and g[1][:4].isdigit():
            a = int(g[1][:4])
            if ANO_MIN <= a <= ANO_MAX:          # descarta datas obviamente erradas
                ano = a
        genero = (g[2].split(";")[0].strip() if g and g[2] else None)
        devs = [x.strip() for x in (g[3].split(";") if g and g[3] else []) if x.strip()]
        pubs = [x.strip() for x in (g[4].split(";") if g and g[4] else []) if x.strip()]
        com_ano += ano is not None
        com_genero += genero is not None

        jogos.append({
            "id": gid, "platform": "xblig", "title": titulo, "wiki": None,
            "year": ano, "genre": genero, "developers": devs, "publishers": pubs,
            "flags": {"xbla": False, "xblig": True, "dl": True,
                      "kinect": None, "stereo3d": False, "xboxOne": False},
            "iaCover": caminho,
            # URL remota serve de reserva se o arquivo local faltar
            "image": "https://archive.org/download/" + IA_ITEM + "/" + urllib.parse.quote(caminho),
        })
        tags[gid] = tags_do_titulo(titulo)

    from wikilib import save  # reaproveita o gravador
    save("data/xblig.json", jogos)
    with open(os.path.join(ROOT, "data", "tags-xblig.json"), "w", encoding="utf-8") as f:
        json.dump(tags, f, ensure_ascii=False, indent=1)
    print("gravado data/tags-xblig.json (%d)" % len(tags))
    print("  com ano: %d (%.0f%%) | com genero: %d (%.0f%%)" %
          (com_ano, com_ano / len(jogos) * 100, com_genero, com_genero / len(jogos) * 100))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.join(ROOT, "tools"))
    sys.exit(main())
