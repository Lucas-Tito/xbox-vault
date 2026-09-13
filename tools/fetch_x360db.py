#!/usr/bin/env python3
"""Dados do Marketplace do Xbox 360, do arquivo aberto x360db.

O x360db (github.com/xenia-manager/x360db) e uma recriacao da base do Marketplace
do Xbox 360, mantida pela equipe do Xenia. O campo que nos interessa e
"user_rating": a media das estrelas que os jogadores davam na loja, de 0 a 5.

Vale porque e uma nota de natureza diferente da do Metacritic -- publico em vez
de critica -- e porque cobre justamente o buraco: milhares de jogos do catalogo
nunca tiveram resenha de critica, mas tiveram gente votando na loja.

Tambem sai daqui a desenvolvedora e a publicadora de quem nao tem: a Wikipedia
deixou 275 jogos sem esse campo e o x360db tem os dois em 100% das entradas.

E um arquivo so de 1,8 MB, sem varredura pagina a pagina.

Nao aproveitamos daqui: tamanho (o x360db nao tem esse campo) e DLC (o campo
"products" existe mas esta vazio ate nos jogos com mais DLC do console).
"""
import json, os, re, sys, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTE = "https://raw.githubusercontent.com/xenia-manager/x360db/HEAD/games.json"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


def main():
    cache = os.path.join(ROOT, "cache", "x360db-games.json")
    if os.path.exists(cache) and "--refazer" not in sys.argv:
        with open(cache, encoding="utf-8") as f:
            x = json.load(f)
        print("x360db do cache: %d entradas" % len(x))
    else:
        req = urllib.request.Request(FONTE, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            x = json.loads(r.read().decode("utf-8"))
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(x, f)
        print("x360db baixado: %d entradas" % len(x))

    # So Xbox 360 e indies: o x360db nao cobre Xbox original nem emulacao
    nossos = {}
    for arq in ("x360.json", "xblig.json"):
        for g in json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8")):
            nossos.setdefault(norm(g["title"]), g["id"])

    out, dup, semnota = {}, 0, 0
    for g in x:
        i = nossos.get(norm(g.get("title")))
        if not i:
            continue
        try:
            nota = float(g.get("user_rating") or 0)
        except (TypeError, ValueError):
            nota = 0
        if not 0 < nota <= 5:
            nota = 0
            semnota += 1
        reg = {"titleId": g.get("id")}
        if nota:
            reg["ur"] = round(nota, 2)
        if g.get("developer"):
            reg["dev"] = g["developer"].strip()
        if g.get("publisher"):
            reg["pub"] = g["publisher"].strip()
        if i in out:
            dup += 1
            # o Marketplace tem entradas repetidas por regiao; fica a maior nota
            if reg.get("ur", 0) <= out[i].get("ur", 0):
                continue
        out[i] = reg

    saida = os.path.join(ROOT, "data", "x360db.json")
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("casaram %d jogos (%d sem nota util, %d titulos repetidos)"
          % (len(out), semnota, dup))
    print("   com nota de jogador: %d | com desenvolvedora: %d | com publicadora: %d"
          % (sum(1 for v in out.values() if v.get("ur")),
             sum(1 for v in out.values() if v.get("dev")),
             sum(1 for v in out.values() if v.get("pub"))))
    print("-> data/x360db.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
