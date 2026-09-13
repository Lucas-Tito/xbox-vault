#!/usr/bin/env python3
"""Monta o catalogo de EMULACAO (SNES, GBA, PS1) a partir do dump do LaunchBox.

O Xbox 360 roda esses sistemas via homebrew, entao eles cabem na premissa do
site. Ficam num arquivo separado (data/db-emu.js), carregado sob demanda: a
categoria vem DESLIGADA e quem nunca a liga nao paga nada pelo peso dela.

Diferente do resto do catalogo, aqui as tags de modo de jogo sao BOAS: o dump
traz MaxPlayers (87%) e Cooperative como campos estruturados, em vez de inferidos
do texto de um artigo.
"""
import datetime, json, os, re, sys, unicodedata, zipfile, collections
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DUMP = os.path.join(ROOT, "cache", "launchbox-metadata.zip")
IMG_BASE = "https://images.launchbox-app.com/"
SISTEMAS = {"Super Nintendo Entertainment System": "SNES",
            "Nintendo Game Boy Advance": "GBA",
            "Sony Playstation": "PS1"}
PREFIXO = {"SNES": "emu-snes-", "GBA": "emu-gba-", "PS1": "emu-ps1-"}
# preferencia de regiao quando ha varias capas do mesmo jogo
REGIAO = {"North America": 0, "United States": 1, "World": 2, "Europe": 3, "": 4}
# O limite superior e o ano corrente: SNES, GBA e PS1 tem cena de homebrew ativa
# ate hoje, e o dump cataloga esses lancamentos. Cortar em 2010 descartava 1.237
# jogos com data legitima.
ANO_MIN, ANO_MAX = 1985, datetime.date.today().year


def slug(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return re.sub(r"-+", "-", s).strip("-") or "sem-titulo"


def ler_dump():
    jogos, capas = {}, collections.defaultdict(list)
    with zipfile.ZipFile(DUMP).open("Metadata.xml") as f:
        for _, el in ET.iterparse(f, events=("end",)):
            if el.tag not in ("Game", "GameImage"):
                continue                      # nao limpar filhos antes de ler o pai
            d = {c.tag: (c.text or "") for c in el}
            if el.tag == "Game":
                if d.get("Platform") in SISTEMAS:
                    jogos[d.get("DatabaseID", "")] = d
            elif d.get("Type") == "Box - Front":
                capas[d.get("DatabaseID", "")].append(
                    (REGIAO.get(d.get("Region", ""), 5), d.get("FileName", "")))
            el.clear()
    return jogos, capas


def tags(d):
    """Tags a partir dos campos estruturados. SNES, GBA e PS1 nao tinham online:
    multiplayer nesses sistemas e local por definicao."""
    try:
        n = int(d.get("MaxPlayers") or 0)
    except ValueError:
        n = 0
    if n > 64:
        n = 0
    coop = (d.get("Cooperative") or "").lower() == "true"
    multi = n >= 2
    return {
        "singlePlayer": True,
        "multiplayerLocal": multi,
        "multiplayerOnline": False,
        "coop": bool(coop and multi),
        "coopLocal": bool(coop and multi),
        "coopOnline": False,
        "versus": bool(multi and not coop),
        "versusLocal": bool(multi and not coop),
        "maxPlayersLocal": n if multi else 0,
        "maxPlayersOnline": 0,
        "maxPlayers": n if multi else 0,
        "source": "launchbox" if d.get("MaxPlayers") else "launchbox-sem-maxplayers",
        "confidence": "high" if d.get("MaxPlayers") else "low",
    }


def main():
    jogos_raw, capas = ler_dump()
    print("jogos nas 3 plataformas: %d" % len(jogos_raw))

    jogos, tg, usados = [], {}, set()
    stat = collections.Counter()
    for dbid, d in sorted(jogos_raw.items(), key=lambda kv: kv[1].get("Name", "")):
        sis = SISTEMAS[d["Platform"]]
        base = PREFIXO[sis] + slug(d.get("Name", ""))
        gid, n = base, 2
        while gid in usados:
            gid = "%s-%d" % (base, n); n += 1
        usados.add(gid)

        ano = None
        rd = d.get("ReleaseDate", "")[:4]
        if rd.isdigit() and ANO_MIN <= int(rd) <= ANO_MAX:
            ano = int(rd)
        fn = sorted(capas[dbid])[0][1] if capas.get(dbid) else None
        stat[sis] += 1
        stat["com_capa"] += fn is not None
        stat["com_ano"] += ano is not None
        stat["tipo:" + (d.get("ReleaseType") or "Released")] += 1

        jogos.append({
            "id": gid, "platform": "emu", "system": sis,
            "title": d.get("Name", ""), "wiki": None, "year": ano,
            "genre": (d.get("Genres", "").split(";")[0].strip() or None),
            "developers": [x.strip() for x in d.get("Developer", "").split(";") if x.strip()],
            "publishers": [x.strip() for x in d.get("Publisher", "").split(";") if x.strip()],
            # LaunchBox separa oficial de ROM hack; o site filtra por isso
            "releaseType": (d.get("ReleaseType") or "Released"),
            "image": (IMG_BASE + fn) if fn else None,   # reserva remota
            "lbFile": fn,
        })
        tg[gid] = tags(d)

    # O LaunchBox marca de "Unreleased" tanto jogo que ficou pronto e vazou quanto
    # prototipo pela metade. Fica so a lista curada a mao em data/vazados.json.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import aplica_vazados
    jogos, tg, _ = aplica_vazados.aplicar(jogos, tg)
    vivos = {g["id"] for g in jogos}
    stat["SNES"] = sum(1 for g in jogos if g["system"] == "SNES")
    stat["GBA"] = sum(1 for g in jogos if g["system"] == "GBA")
    stat["PS1"] = sum(1 for g in jogos if g["system"] == "PS1")
    stat["com_capa"] = sum(1 for g in jogos if g.get("lbFile"))
    stat["com_ano"] = sum(1 for g in jogos if g.get("year"))

    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    for nome, obj in [("emu.json", jogos), ("tags-emu.json", tg)]:
        p = os.path.join(ROOT, "data", nome)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        print("gravado data/%s (%.1f KB)" % (nome, os.path.getsize(p) / 1024))
    print("  SNES %d | GBA %d | PS1 %d" % (stat["SNES"], stat["GBA"], stat["PS1"]))
    print("  com capa %d (%.0f%%) | com ano %d (%.0f%%)" %
          (stat["com_capa"], stat["com_capa"] / len(jogos) * 100,
           stat["com_ano"], stat["com_ano"] / len(jogos) * 100))
    tipos = collections.Counter(g["releaseType"] for g in jogos)
    print("  por tipo: " + ", ".join("%s %d" % (k, v) for k, v in sorted(tipos.items())))
    mult = sum(1 for v in tg.values() if v["multiplayerLocal"])
    coop = sum(1 for v in tg.values() if v["coop"])
    print("  multiplayer local %d | co-op %d | confianca alta %d" %
          (mult, coop, sum(1 for v in tg.values() if v["confidence"] == "high")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
