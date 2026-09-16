#!/usr/bin/env python3
"""Tamanho e numero de jogadores da emulacao, do libretro-database.

O catalogo de emulacao nasceu sem tamanho nenhum e com numero de jogadores em
so 36% dos oficiais. As duas coisas existem, abertas e versionadas, no
repositorio libretro/libretro-database, que reune os DATs do No-Intro (cartucho)
e do Redump (disco) mais pastas de metadado por sistema.

POR QUE NAO RASPAR UM SITE DE ROM: o DAT resolve em 5 requisicoes o que um site
resolveria em ~525, entrega o tamanho da ROM EXTRAIDA em bytes (site de download
mostra o arquivo compactado, que mente para baixo na hora de prever espaco),
traz o campo de regiao para escolher qual versao medir, e nao quebra quando
alguem troca o tema do site.

    game (
        name "Super Mario World (USA)"
        region "USA"
        rom ( name "Super Mario World (USA).sfc" size 524288 crc B19ED489 ... )
    )

REGIAO: o mesmo jogo aparece uma vez por regiao, com tamanhos diferentes. A
ordem de preferencia e USA, World, Europe, Japan, e depois qualquer uma, para
o numero ser sempre o da versao mais provavel de estar na mao de quem usa o
site. A escolhida fica gravada junto, entao da para conferir depois.

JOGADORES: vem da pasta metadat/maxusers, que casa por titulo. Ela e a fonte
PREFERIDA: onde o libretro fala, o numero dele vale, mesmo que o LaunchBox ja
tivesse um. Onde ele nao fala, o do LaunchBox continua. So o NUMERO e trocado;
nenhum modo de jogo e apagado. Quando o libretro diz 2 ou mais e o catalogo
nao marcava multiplayer local, a marca entra: dois controles num SNES sao
multiplayer local, e deixar so o numero criaria ficha que filtra por 2 jogadores
sem dizer que o jogo tem multiplayer.

PS1 fica so com o tamanho: a pasta maxusers tem 41 arquivos e nenhum de disco.

Saida:
    data/tamanho-emu.json          id -> GB (mesmo formato do tamanho.json)
    data/jogadores-emu.json        id -> {"users": n, "regiao": "USA"}
    data/divergencia-jogadores.json  onde as duas fontes discordam; nao e lido
                                     pelo bundle, existe para a analise da #24

uso: python3 tools/fetch_libretro.py [--refazer]
"""
import json, os, re, sys, unicodedata, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402

CACHE = os.path.join(ROOT, "cache")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
BASE = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat/"

# sistema -> (DAT de tamanho, DAT de jogadores ou None)
FONTES = {
    "SNES": ("no-intro/Nintendo - Super Nintendo Entertainment System.dat",
             "maxusers/Nintendo - Super Nintendo Entertainment System.dat"),
    "GBA":  ("no-intro/Nintendo - Game Boy Advance.dat",
             "maxusers/Nintendo - Game Boy Advance.dat"),
    "PS1":  ("redump/Sony - PlayStation.dat", None),
}
REGIOES = ["USA", "World", "Europe", "Japan"]
GB = 1024 ** 3


def norm(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", t)


def sem_parenteses(nome):
    """'Super Mario World (USA) (Rev 1)' -> 'supermarioworld'"""
    return norm(re.sub(r"\s*\([^)]*\)", "", nome))


def baixar(caminho, refazer=False):
    """Le o DAT, do cache se ja estiver la. Sao arquivos de texto versionados:
    nao mudam de um dia para o outro e nao ha razao para bater no GitHub duas
    vezes na mesma semana."""
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, "libretro-" + re.sub(r"[^a-z0-9]+", "-", caminho.lower()))
    if os.path.exists(local) and not refazer:
        with open(local, encoding="utf-8", errors="replace") as f:
            return f.read()
    url = BASE + urllib.request.quote(caminho)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        txt = r.read().decode("utf-8", "replace")
    with open(local, "w", encoding="utf-8") as f:
        f.write(txt)
    print("   baixado: %s (%d KB)" % (caminho, len(txt) / 1024))
    return txt


def ler_tamanhos(txt):
    """nome completo -> (bytes, regiao). Jogo de disco tem uma linha rom por
    faixa, e o que ocupa e a soma delas."""
    out = {}
    for bloco in txt.split("\ngame (")[1:]:
        m = re.search(r'\n\s*name "(.*?)"', bloco)
        if not m:
            continue
        tam = sum(int(x) for x in re.findall(r"\ssize (\d+)", bloco))
        if not tam:
            continue
        reg = re.search(r'\n\s*region "(.*?)"', bloco)
        out[m.group(1)] = (tam, reg.group(1) if reg else "")
    return out


def ler_campo(txt, campo):
    """nome completo -> valor. Os metadados casam por 'comment', nao por 'name'."""
    out = {}
    for bloco in txt.split("\ngame (")[1:]:
        m = re.search(r'\n\s*(?:comment|name) "(.*?)"', bloco)
        v = re.search(r'\n\s*%s\s+"?([^"\n]+?)"?\s*$' % campo, bloco, re.M)
        if m and v:
            out[m.group(1)] = v.group(1).strip()
    return out


def escolher(cands):
    """Entre as versoes regionais do mesmo jogo, a da regiao preferida. Empate
    ou regiao desconhecida: a maior, que e a completa (as outras costumam ser
    demo ou versao cortada)."""
    for reg in REGIOES:
        no_reg = [c for c in cands if c[2] == reg]
        if no_reg:
            return max(no_reg, key=lambda c: c[1])
    return max(cands, key=lambda c: c[1])


def main():
    refazer = "--refazer" in sys.argv
    jogos = json.load(open(os.path.join(ROOT, "data", "emu.json"), encoding="utf-8"))

    tamanhos, jogadores, diverg = {}, {}, {}
    for sis, (dat_tam, dat_usr) in FONTES.items():
        print("%s:" % sis, flush=True)
        tam_por_nome = ler_tamanhos(baixar(dat_tam, refazer))
        usr_por_nome = ler_campo(baixar(dat_usr, refazer), "users") if dat_usr else {}

        # indice por titulo sem o parentese de regiao: um titulo, varias versoes
        idx = {}
        for nome, (b, reg) in tam_por_nome.items():
            idx.setdefault(sem_parenteses(nome), []).append((nome, b, reg))
        idx_usr = {}
        for nome, v in usr_por_nome.items():
            try:
                n = int(re.sub(r"\D", "", v) or 0)
            except ValueError:
                continue
            if n:
                idx_usr.setdefault(sem_parenteses(nome), n)

        casou = com_usr = 0
        for g in jogos:
            if g.get("system") != sis:
                continue
            chave = norm(g["title"])
            cands = idx.get(chave)
            if cands:
                nome, b, reg = escolher(cands)
                tamanhos[g["id"]] = round(b / GB, 6)
                casou += 1
            n = idx_usr.get(chave)
            if n:
                jogadores[g["id"]] = {"users": n, "regiao": reg if cands else ""}
                com_usr += 1
        print("   %d com tamanho, %d com numero de jogadores" % (casou, com_usr))

    # onde o LaunchBox ja tinha numero e o libretro discorda: material da #24
    tags = json.load(open(os.path.join(ROOT, "data", "tags-emu.json"), encoding="utf-8"))
    for gid, d in jogadores.items():
        velho = (tags.get(gid) or {}).get("maxPlayers") or 0
        if velho and velho != d["users"]:
            diverg[gid] = {"launchbox": velho, "libretro": d["users"]}

    jsonio.salvar(os.path.join(ROOT, "data", "tamanho-emu.json"), tamanhos)
    jsonio.salvar(os.path.join(ROOT, "data", "jogadores-emu.json"), jogadores)
    jsonio.salvar(os.path.join(ROOT, "data", "divergencia-jogadores.json"), diverg)
    print("\ndata/tamanho-emu.json: %d jogos" % len(tamanhos))
    print("data/jogadores-emu.json: %d jogos" % len(jogadores))
    print("data/divergencia-jogadores.json: %d discordancias com o LaunchBox" % len(diverg))
    return 0


if __name__ == "__main__":
    sys.exit(main())
