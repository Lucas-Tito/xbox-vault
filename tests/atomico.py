#!/usr/bin/env python3
"""Prova que os coletores nao entregam JSON pela metade.

Os coletores salvam a cada 25 ou 100 itens, durante horas. Com open(...,"w") o
arquivo ficava truncado por uma fracao de segundo a cada volta, e quem lesse
naquele instante -- o bundle.py, ou o proprio coletor sendo retomado -- pegava
JSON invalido. O jsonio.salvar troca um temporario pelo destino com os.replace.

Esse bug nao aparece rodando o coletor: a janela e curta demais para o acaso
mostrar, e longa o bastante para acontecer numa coleta de verdade. Por isso as
condicoes que o evitam sao testadas aqui, uma a uma, em vez de so documentadas.

uso: python3 tests/atomico.py
"""
import json, os, shutil, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(
    os.path.abspath(__file__))), "tools"))
import jsonio

R = []


def ok(nome, cond, det=""):
    R.append(bool(cond))
    print("%s %s%s" % ("  ok  " if cond else "FALHOU", nome,
                       "" if cond else "   <- " + str(det)))


def sujeira(d):
    return [n for n in os.listdir(d) if n.startswith(".tmp-")]


def main():
    d = tempfile.mkdtemp(prefix="xbx-atomico-")
    try:
        alvo = os.path.join(d, "saida.json")

        # 1) o basico: grava e le de volta
        jsonio.salvar(alvo, {"b": 2, "a": 1})
        with open(alvo, encoding="utf-8") as f:
            ok("grava e le de volta", json.load(f) == {"a": 1, "b": 2})

        # 2) o formato tem de ser o mesmo de antes, senao trocar a chamada nos
        #    coletores reescreveria data/*.json inteiro no primeiro save
        dados = {"z": 1, "a": {"n": 2}, "ç": "acentuado"}
        for kw in ({}, {"indent": 0}, {"sort_keys": False},
                   {"indent": 0, "ensure_ascii": True}):
            esperado = json.dumps(dados, ensure_ascii=kw.get("ensure_ascii", False),
                                  indent=kw.get("indent", 1),
                                  sort_keys=kw.get("sort_keys", True))
            jsonio.salvar(alvo, dados, **kw)
            with open(alvo, encoding="utf-8") as f:
                obtido = f.read()
            ok("formato identico ao json.dump %s" % (kw or "padrao"),
               obtido == esperado, "%r != %r" % (obtido[:40], esperado[:40]))

        # 3) sucesso nao deixa temporario para tras
        ok("sucesso nao deixa .tmp", not sujeira(d), sujeira(d))

        # 4) erro no meio da serializacao preserva o arquivo que ja estava la.
        #    set nao e serializavel: o json.dump quebra depois de ja ter escrito
        #    parte do conteudo, que e exatamente o caso perigoso.
        jsonio.salvar(alvo, {"antigo": True})
        try:
            jsonio.salvar(alvo, {"bom": 1, "ruim": {1, 2, 3}})
            ok("erro de serializacao levanta", False, "nao levantou")
        except TypeError:
            ok("erro de serializacao levanta", True)
        with open(alvo, encoding="utf-8") as f:
            ok("erro nao toca no arquivo antigo", json.load(f) == {"antigo": True})
        ok("erro nao deixa .tmp", not sujeira(d), sujeira(d))

        # 5) Ctrl+C no meio de uma coleta de horas e o caso real, e
        #    KeyboardInterrupt nao e Exception: tem de cair no mesmo cuidado
        dump = json.dump

        def dump_interrompido(*a, **k):
            raise KeyboardInterrupt

        json.dump = dump_interrompido
        try:
            jsonio.salvar(alvo, {"novo": 1})
            ok("Ctrl+C no meio levanta", False, "nao levantou")
        except KeyboardInterrupt:
            ok("Ctrl+C no meio levanta", True)
        finally:
            json.dump = dump
        with open(alvo, encoding="utf-8") as f:
            ok("Ctrl+C nao toca no arquivo antigo", json.load(f) == {"antigo": True})
        ok("Ctrl+C nao deixa .tmp", not sujeira(d), sujeira(d))

        # 6) os.replace so e atomico dentro do mesmo sistema de arquivos: o
        #    temporario precisa nascer no diretorio do destino, nao em /tmp
        visto = {}
        replace = os.replace

        def espiao(src, dst):
            visto["src"], visto["dst"] = src, dst
            return replace(src, dst)

        jsonio.os.replace = espiao
        try:
            jsonio.salvar(alvo, {"x": 1})
        finally:
            jsonio.os.replace = replace
        ok("temporario nasce no diretorio do destino",
           os.path.dirname(visto.get("src", "")) == os.path.dirname(visto.get("dst", "!")),
           visto)

        # 7) diretorio que ainda nao existe
        novo = os.path.join(d, "fundo", "do", "poco.json")
        jsonio.salvar(novo, [1, 2])
        ok("cria o diretorio que falta", os.path.exists(novo))
    finally:
        shutil.rmtree(d, ignore_errors=True)

    falhas = R.count(False)
    print("\n%d assercoes, %d falhas" % (len(R), falhas))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
