#!/usr/bin/env python3
"""Completa data/metacritic.json buscando no proprio Metacritic os jogos sem nota.

A extracao da Wikipedia (tools/build_metacritic.py) cobre ~70%. O resto vem
daqui: le a nota na pagina de resenhas DA PLATAFORMA, que e a unica que da a
nota certa por plataforma (ver tools/mcweb.py).

O endereco de cada jogo sai, em ordem: da URL que o proprio artigo da Wikipedia
cita, ou de um slug derivado do titulo. Como slug derivado pode cair em outro
jogo, a pagina so e aceita se nome E ano baterem.

Resumivel: roda de novo e continua de onde parou.
"""
import json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wikilib as w
import mcweb

PAUSA = 1.5
LIMITE_SLUGS = 3                      # educado: uma requisicao a cada 1,5 s
URL_MC = re.compile(r"metacritic\.com/game/(?:[a-z0-9\-]+/)?([a-z0-9][a-z0-9\-]{2,70})", re.I)
# Cada alvo grava no SEU arquivo. Com dois processos em paralelo um arquivo unico
# seria fatal: cada um carrega o JSON inteiro na memoria e reescreve tudo a cada
# checkpoint, entao um apagaria as notas do outro. bundle.py junta os tres.
SAIDAS = {"xbox": "metacritic.json", "indies": "metacritic-indies.json",
          "emu": "metacritic-emu.json"}
SAIDA = os.path.join(ROOT, "data", "metacritic.json")


def slugs_possiveis(g, wikitext, limite_slugs=3):
    """Candidatos de endereco, do mais confiavel ao menos."""
    out = []
    if wikitext:
        for m in URL_MC.finditer(wikitext):
            s = m.group(1).lower()
            if s not in ("critic-reviews", "user-reviews") and s not in out:
                out.append(s)
    d = mcweb.slug_do_titulo(g["title"])
    if d and d not in out:
        out.append(d)
    # titulo sem subtitulo depois de ":" costuma ser o slug no Metacritic
    if ":" in g["title"]:
        d2 = mcweb.slug_do_titulo(g["title"].split(":")[0])
        if d2 and d2 not in out:
            out.append(d2)
    return out[:limite_slugs]


ALVOS = {
    # rotulo: (arquivo, como descobrir a plataforma, usa nota geral como reserva?)
    "xbox":   ([("x360.json", "x360"), ("xbox.json", "xbox")], False),
    "indies": ([("xblig.json", "x360")], True),
    "emu":    ([("emu.json", None)], False),      # None = usa o campo "system"
}


def main():
    alvo = sys.argv[1] if len(sys.argv) > 1 else "xbox"
    limite = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    if alvo not in ALVOS:
        print("uso: fill_metacritic.py [xbox|indies|emu] [limite]")
        return 2
    arquivos, usa_geral = ALVOS[alvo]
    saida = os.path.join(ROOT, "data", SAIDAS[alvo])
    # Nos indies o acerto e ~1,4%: tentar 3 enderecos por jogo gasta 4x mais
    # requisicao para quase nenhum ganho. Um endereco + busca geral basta.
    global LIMITE_SLUGS
    LIMITE_SLUGS = 1 if alvo == "indies" else 3

    notas = {}
    if os.path.exists(saida):
        with open(saida, encoding="utf-8") as f:
            notas = json.load(f)
    ja_feitos = set(notas)
    for outro in SAIDAS.values():           # nao refaz o que outro alvo ja resolveu
        p2 = os.path.join(ROOT, "data", outro)
        if p2 != saida and os.path.exists(p2):
            with open(p2, encoding="utf-8") as f:
                ja_feitos |= set(json.load(f))
    print("alvo=%s | no meu arquivo: %d | ja processados no total: %d"
          % (alvo, len(notas), len(ja_feitos)))

    faltando = []
    for arq, plat_fixa in arquivos:
        jogos = json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8"))
        arts = {}
        comwiki = [g for g in jogos if g.get("wiki")]
        if comwiki:
            arts = w.batch_wikitext([g["wiki"] for g in comwiki])
        for g in jogos:
            if g["id"] in ja_feitos:
                continue
            plat = plat_fixa or g.get("system")
            if alvo == "emu" and plat == "SNES":
                continue            # o Metacritic comecou em 2001; o SNES acabou em 1998
            if alvo == "emu" and g.get("releaseType") != "Released":
                continue            # ROM hack nao tem resenha de critica
            if not plat:
                continue
            faltando.append((g, plat, arts.get(g.get("wiki") or "")))
    print("sem nota: %d" % len(faltando))
    if limite:
        faltando = faltando[:limite]

    achou = geral = erro = 0
    t0 = time.time()
    for i, (g, plat, wt) in enumerate(faltando, 1):
        registrado = False
        for slug in slugs_possiveis(g, wt, LIMITE_SLUGS):
            n, info = mcweb.nota(slug, plat, g["title"], g.get("year"))
            time.sleep(PAUSA)
            if n is not None:
                notas[g["id"]] = {"score": n, "via": "metacritic-web"}
                achou += 1; registrado = True
                break
        if not registrado and usa_geral:
            for slug in slugs_possiveis(g, wt, 1):
                n, plats = mcweb.nota_geral(slug, g["title"], g.get("year"))
                time.sleep(PAUSA)
                if n is not None:
                    # nota que NAO e da nossa plataforma: marcada para o site avisar
                    notas[g["id"]] = {"score": n, "via": "metacritic-geral",
                                      "geral": True, "plats": plats}
                    geral += 1; registrado = True
                    break
        if not registrado:
            # grava a falha: sem isso, reiniciar refaz todos os que ja falharam.
            # bundle.py ignora entradas sem score inteiro, entao nao vira nota.
            notas[g["id"]] = {"score": None, "via": "nao-encontrado"}
            erro += 1
        if i % 25 == 0 or i == len(faltando):
            with open(saida, "w", encoding="utf-8") as f:
                json.dump(notas, f, ensure_ascii=False, indent=1)
            print("  %d/%d  plataforma=%d geral=%d nao-achou=%d  %.0fs" %
                  (i, len(faltando), achou, geral, erro, time.time() - t0), flush=True)

    with open(saida, "w", encoding="utf-8") as f:
        json.dump(notas, f, ensure_ascii=False, indent=1)
    print("\ntotal agora: %d (+%d da plataforma, +%d gerais)" % (len(notas), achou, geral))
    return 0


if __name__ == "__main__":
    sys.exit(main())
