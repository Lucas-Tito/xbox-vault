#!/usr/bin/env python3
"""Prova que o coletor de tempo nunca apaga o que foi conferido a mao.

data/tempo.json e escrito por uma pessoa; data/hltb*.json e escrito por um robo
que roda por horas sem ninguem olhando. Quem decide entre os dois e o
juntar_tempo() do bundle.py, e um erro ali nao aparece na tela: o site mostraria
um numero plausivel, so que o errado, e a curadoria teria sumido sem aviso.

Por isso a regra e testada em vez de so documentada.

uso: python3 tests/tempo.py
"""
import os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "tools"))
from bundle import juntar_tempo

MANUAIS = {
    "a": {"main": 9, "plus": 12, "cem": 35, "fonte": "manual"},
    "b": {"main": 9, "plus": 12, "cem": 35, "fonte": "aproximado"},
    "c": {"main": 5, "fonte": "aproximado"},
    "e": {"main": 4, "fonte": "manual"},
}
COLETADOS = {
    "a": {"main": 7.7, "plus": 10.9, "cem": 22.2, "n": 1183, "via": "plataforma"},
    "b": {"main": 9.1, "plus": 12.4, "cem": 24.0, "n": 575, "via": "plataforma"},
    "d": {"main": 8.8, "n": 291, "via": "plataforma"},
    "e": {"main": 99, "plus": 50, "n": 10, "via": "plataforma"},
    "f": {"nao": "sem-resultado"},
    # sem linha da nossa plataforma: sobra o agregado de todas as versoes
    "i": {"main": 33.6, "n": 14, "via": "geral"},
    # forma da VERSAO 1, que convive em disco enquanto a coleta migra: "n" era um
    # dicionario por medida e nao havia campo "via"
    "k": {"main": 9.0, "n": {"cem": 51, "main": 635, "plus": 227}},
}

CASOS = [
    ("a", "numero conferido a mao vence o coletor, mesmo com 1.183 relatos contra",
     {"main": 9, "plus": 12, "cem": 35, "fonte": "manual"}),
    ("b", "entrada 'aproximado' cede a vez: ela existe para ser corrigida",
     {"main": 9.1, "plus": 12.4, "cem": 24.0, "fonte": "hltb", "n": 575}),
    ("c", "'aproximado' fica de pe enquanto o coletor nao trouxer nada",
     {"main": 5, "fonte": "aproximado"}),
    ("d", "sem curadoria, vale o coletor",
     {"main": 8.8, "fonte": "hltb", "n": 291}),
    ("i", "numero que soma todas as versoes sai marcado, para o popup avisar",
     {"main": 33.6, "fonte": "hltb", "n": 14, "geral": True}),
    ("e", "manual incompleto NAO e completado pelo coletor: misturar as duas "
          "fontes numa entrada so daria um tempo que ninguem mediu",
     {"main": 4, "fonte": "manual"}),
    ("k", "registro da versao 1 ainda e lido durante a migracao, e sai marcado "
          "como 'geral' -- ele nao tem 'via' e o numero dele soma todas as versoes",
     {"main": 9.0, "fonte": "hltb", "n": 635, "geral": True}),
    ("f", "coletado sem medida nenhuma nao vira tempo na tela", None),
    ("g", "jogo sem nada em lugar nenhum", None),
]


def main():
    falhas = 0
    for gid, desc, esperado in CASOS:
        obtido = juntar_tempo(gid, MANUAIS, COLETADOS)
        ok = obtido == esperado
        falhas += 0 if ok else 1
        print("%s %s" % ("  ok  " if ok else "FALHOU", desc))
        if not ok:
            print("         esperado: %r\n         obtido:   %r" % (esperado, obtido))

    # O numero da NOSSA versao nunca pode sair marcado como se somasse todas:
    # o popup usaria a frase errada e o leitor desconfiaria do dado bom.
    r = juntar_tempo("j", {}, {"j": {"main": 9.1, "n": 575, "via": "plataforma"}})
    ok = r == {"main": 9.1, "fonte": "hltb", "n": 575}
    falhas += 0 if ok else 1
    print("%s tempo da nossa versao nao recebe a marca de 'geral'"
          % ("  ok  " if ok else "FALHOU"))
    if not ok:
        print("         obtido: %r" % (r,))

    print("\n%d assercoes, %d falhas" % (len(CASOS) + 1, falhas))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
