#!/usr/bin/env python3
"""Extrai a nota do Metacritic dos artigos da Wikipedia e grava data/metacritic.json.

Nao ha como raspar o Metacritic direto (bloqueio agressivo), mas os artigos da
Wikipedia citam a nota junto com a URL da propria pagina do Metacritic -- e essa
URL diz a plataforma. Ver tools/metacritic.py para os tres formatos tratados.

So vale para Xbox 360 e Xbox original: XBLIG e emulacao nao tem artigo mapeado.
"""
import collections, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wikilib as w
import metacritic as mc


def main():
    saida, via = {}, collections.Counter()
    for arq, plat in [("x360.json", "x360"), ("xbox.json", "xbox")]:
        with open(os.path.join(ROOT, "data", arq), encoding="utf-8") as f:
            jogos = json.load(f)
        com_wiki = [g for g in jogos if g.get("wiki")]
        print("%s: %d jogos, %d com artigo" % (arq, len(jogos), len(com_wiki)))
        arts = w.batch_wikitext([g["wiki"] for g in com_wiki])
        achou = 0
        for g in com_wiki:
            wt = arts.get(g["wiki"])
            if not wt:
                continue
            nota, como = mc.extrair(wt, plat, g["title"])
            if nota is None:
                continue
            saida[g["id"]] = {"score": nota, "via": como}
            via[como] += 1
            achou += 1
        print("  com nota: %d (%.0f%%)" % (achou, achou / len(jogos) * 100))

    p = os.path.join(ROOT, "data", "metacritic.json")
    # NAO sobrescrever cego: fill_metacritic.py grava no MESMO arquivo as notas
    # buscadas no site. Reescrever so com o que veio do wikitext apagaria tudo
    # que ele coletou -- foi assim que 535 notas se perderam.
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            antes = json.load(f)
        preservadas = {k: v for k, v in antes.items() if k not in saida}
        if preservadas:
            print("  preservando %d entradas de outra origem (fill_metacritic)" % len(preservadas))
        antes.update(saida)
        saida = antes
    with open(p + ".tmp", "w", encoding="utf-8") as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    os.replace(p + ".tmp", p)
    print("\ngravado data/metacritic.json (%d notas, %.1f KB)" %
          (len(saida), os.path.getsize(p) / 1024))
    print("  por metodo:", dict(via))
    notas = [v["score"] for v in saida.values() if isinstance(v.get("score"), int)]
    if notas:
        faixas = collections.Counter(min(n // 10 * 10, 90) for n in notas)
        print("  distribuicao:", " ".join("%d-%d:%d" % (k, k + 9, faixas[k])
                                          for k in sorted(faixas)))
        print("  media %.1f | min %d | max %d" % (sum(notas) / len(notas), min(notas), max(notas)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
