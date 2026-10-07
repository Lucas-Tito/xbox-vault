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

E daqui que sai o Title ID do 360 e dos indies, com os alternativos (outras
regioes, disco e Arcade). O nome no x360db e o curto da loja ("GTA IV",
"Sonics UGC"): o casamento com o catalogo mora no titlelib.py.

Nao aproveitamos daqui: tamanho (o x360db nao tem esse campo) e DLC (o campo
"products" existe mas esta vazio ate nos jogos com mais DLC do console).
"""
import json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402
import titlelib  # noqa: E402
FONTE = "https://raw.githubusercontent.com/xenia-manager/x360db/HEAD/games.json"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"


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
    catalogo = []
    for arq in ("x360.json", "xblig.json"):
        for g in json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8")):
            catalogo.append((g["id"], g["title"], g.get("year")))

    def nota_de(g):
        try:
            n = float(g.get("user_rating") or 0)
        except (TypeError, ValueError):
            n = 0
        return n if 0 < n <= 5 else 0

    def ano(k):
        # A data e a do relancamento digital, ou 2008-01-01 de preenchimento,
        # que nao serve de teto.
        d = x[k].get("release_date") or ""
        return int(d[:4]) if d[:4].isdigit() and d != "2008-01-01" else None

    # Nome curto da loja ("GTA IV", "Sonics UGC"): titlelib.casar faz o nome
    # igual e, para o resto, o casamento tolerante sem disputa.
    casados = titlelib.casar([(k, g.get("title")) for k, g in enumerate(x)], catalogo, ano)

    out, dup, semnota, aprox = {}, 0, 0, 0
    for i, (chaves, modo) in casados.items():
        # o Marketplace tem entradas repetidas por regiao; os dados saem da de
        # maior nota, e o Title ID das outras vira alternativo
        dup += len(chaves) - 1
        g = max((x[k] for k in chaves), key=nota_de)
        nota = nota_de(g)
        if not nota:
            semnota += 1
        reg = {"titleId": g.get("id")}
        # Todos os Title IDs do mesmo jogo: as outras regioes e o alternative_id
        # (disco e Arcade, edicoes). O CollectionUI guarda o do disco que o
        # console achou, que pode ser qualquer um deles.
        outros = set()
        for k in chaves:
            outros.add((x[k].get("id") or "").upper())
            outros.update(a.upper() for a in (x[k].get("alternative_id") or []))
        outros.discard(reg["titleId"].upper())
        outros.discard("")
        if outros:
            reg["outros"] = sorted(outros)
        if modo == "aprox":
            reg["aprox"] = True       # casado pelo nome curto, nao pelo nome igual
            aprox += 1
        if nota:
            reg["ur"] = round(nota, 2)
        if g.get("developer"):
            reg["dev"] = g["developer"].strip()
        if g.get("publisher"):
            reg["pub"] = g["publisher"].strip()
        out[i] = reg

    saida = os.path.join(ROOT, "data", "x360db.json")
    jsonio.salvar(saida, out)
    print("casaram %d jogos (%d pelo nome curto, %d sem nota util, %d titulos repetidos)"
          % (len(out), aprox, semnota, dup))
    print("   com Title ID alternativo: %d" % sum(1 for v in out.values() if v.get("outros")))
    print("   com nota de jogador: %d | com desenvolvedora: %d | com publicadora: %d"
          % (sum(1 for v in out.values() if v.get("ur")),
             sum(1 for v in out.values() if v.get("dev")),
             sum(1 for v in out.values() if v.get("pub"))))
    print("-> data/x360db.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
