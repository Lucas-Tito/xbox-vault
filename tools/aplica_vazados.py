#!/usr/bin/env python3
"""Tira da emulacao os cancelados que nao da para jogar e promove os que da.

O LaunchBox joga tudo que nunca saiu no mesmo balde (ReleaseType=Unreleased), sem
dizer se a build existente e o jogo inteiro ou um prototipo pela metade. Como a
maioria e sucata (81 dos 136 nao tem nem ano nem capa), o balde inteiro sai e
volta so a lista curada a mao de data/vazados.json, com releaseType "Vazado" --
que o site mostra por padrao, junto dos lancamentos normais.

Idempotente: rodar duas vezes nao muda nada. build_emu.py aplica a mesma regra
quando o catalogo e reconstruido do zero.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wikilib

ROOT = wikilib.ROOT
D = os.path.join(ROOT, "data")


def carregar_curadoria():
    with open(os.path.join(D, "vazados.json"), encoding="utf-8") as f:
        v = json.load(f)
    return {e["id"]: e for e in v["emu"]}, v["catalogo"]


def aplicar(emu, tags):
    """Filtra a lista de emulacao pela curadoria. Devolve (jogos, tags, descartados).

    Usada tanto pela migracao quanto por build_emu.py, para que reconstruir o
    catalogo do zero produza exatamente o mesmo resultado.
    """
    curados, _ = carregar_curadoria()
    novos, jogados_fora, promovidos = [], [], 0
    for g in emu:
        if g.get("releaseType") in ("Unreleased", "Vazado"):
            c = curados.get(g["id"])
            if not c:
                jogados_fora.append(g["id"])
                continue
            g["releaseType"] = "Vazado"
            for campo in ("title", "year"):
                if c.get(campo) is not None:
                    g[campo] = c[campo]
            g["nota"] = c["nota"]
            g["fonte"] = c["fonte"]
            promovidos += 1
        novos.append(g)

    faltando = set(curados) - {g["id"] for g in novos}
    if faltando:
        raise SystemExit("RECUSADO: vazados.json cita ids que nao existem em emu.json: %s"
                         % sorted(faltando))

    fora = set(jogados_fora)
    print("emulacao: %d -> %d (%d descartados, %d promovidos a 'Vazado')"
          % (len(emu), len(novos), len(fora), promovidos))
    return novos, {k: v for k, v in tags.items() if k not in fora}, fora


def main():
    with open(os.path.join(D, "emu.json"), encoding="utf-8") as f:
        emu = json.load(f)
    with open(os.path.join(D, "tags-emu.json"), encoding="utf-8") as f:
        tags = json.load(f)

    novos, tags_novas, fora = aplicar(emu, tags)
    wikilib.save("data/emu.json", novos)
    wikilib.save("data/tags-emu.json", tags_novas)

    # capas dos descartados viram lixo no repo
    apagadas = 0
    for i in fora:
        p = os.path.join(ROOT, "images", i + ".webp")
        if os.path.exists(p):
            os.unlink(p); apagadas += 1
    print("capas orfas apagadas: %d" % apagadas)
    return 0


if __name__ == "__main__":
    sys.exit(main())
