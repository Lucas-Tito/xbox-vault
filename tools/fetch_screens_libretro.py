#!/usr/bin/env python3
"""Uma captura de gameplay por jogo, dos thumbnails do libretro.

A emulacao e o Xbox original nunca tiveram screenshot: o fetch_screens.py puxa a
galeria do Marketplace, que so existe para 360 e XBLIG. O buraco eram 9.830 mais
995 jogos abrindo a ficha com a capa e nada mais.

A org libretro-thumbnails tem um repositorio por console, com quatro pastas:
Named_Snaps (gameplay), Named_Titles (tela de titulo), Named_Boxarts (capa) e
Named_Logos. So a primeira interessa: capa o catalogo ja tem, e tela de titulo e
o logo do jogo num fundo liso, que informa pouco e no PS1 chega a pesar mais que
a propria captura de gameplay.

UMA por jogo, em todos os consoles. Com 480px e WEBP q70 (a mesma regua do
fetch_screens.py) a projecao e de 89 MB para 7.360 jogos:

    SNES  1.531 jogos   16,9 MB        PS1   3.611 jogos   52,4 MB
    GBA   1.390 jogos   13,5 MB        Xbox    828 jogos    6,7 MB

O arquivo se chama "<id>-1.webp" e o screens.json ganha a contagem 1, que e o
mesmo esquema do coletor do Marketplace: a galeria e o visualizador do site
funcionam sem tocar no app.js.

REGIAO: o mesmo jogo aparece uma vez por regiao, e a preferencia e a mesma do
fetch_libretro.py -- USA, World, Europe, Japan -- para a captura ser da versao
mais provavel de estar na mao de quem usa o site.

Resumivel: quem ja tem o arquivo em disco nao e baixado de novo.

uso: python3 tools/fetch_screens_libretro.py [--limite N] [--refazer-lista]
"""
import concurrent.futures as cf
import io, json, os, re, sys, threading, time, unicodedata, urllib.error, urllib.parse, urllib.request
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import jsonio  # noqa: E402

OUT = os.path.join(ROOT, "images", "screens")
CACHE = os.path.join(ROOT, "cache")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
API = "https://api.github.com/repos/libretro-thumbnails/%s/git/trees/%s"
RAW = "https://raw.githubusercontent.com/libretro-thumbnails/%s/master/Named_Snaps/%s"
LARGURA, QUALIDADE, WORKERS = 480, 70, 5
REGIOES = ["USA", "World", "Europe", "Japan"]

# nosso sistema -> repositorio da org libretro-thumbnails
REPOS = {
    "SNES": "Nintendo_-_Super_Nintendo_Entertainment_System",
    "GBA":  "Nintendo_-_Game_Boy_Advance",
    "PS1":  "Sony_-_PlayStation",
    "xbox": "Microsoft_-_Xbox",
}

lock = threading.Lock()
stat = {"ok": 0, "pulados": 0, "sem_captura": 0, "falhas": 0, "bytes": 0}


def norm(t):
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", t)


def sem_parenteses(nome):
    return norm(re.sub(r"\s*\([^)]*\)", "", nome))


def regiao_de(nome):
    """A regiao vem no proprio nome do arquivo: 'Jogo (USA) (Rev 1).png'."""
    for r in REGIOES:
        if "(%s)" % r in nome:
            return r
    return ""


def baixar(url, tries=3, json_=False):
    delay = 1.5
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = r.read()
            return json.loads(dados) if json_ else dados
        except urllib.error.HTTPError as e:
            if e.code in (403, 404) or n == tries - 1:
                return None
        except Exception:
            if n == tries - 1:
                return None
        time.sleep(delay)
        delay *= 2
    return None


def listar(repo, refazer=False):
    """Nomes dos arquivos de Named_Snaps.

    Nao da para pedir a arvore recursiva: o repositorio do PS1 tem 6,6 GB e a
    resposta vem vazia. Entao pega-se a arvore da raiz, acha-se o sha da pasta e
    pede-se so ela. A lista fica em cache porque nao muda de um dia para o outro.
    """
    local = os.path.join(CACHE, "snaps-%s.json" % repo.lower())
    if os.path.exists(local) and not refazer:
        with open(local, encoding="utf-8") as f:
            return json.load(f)
    raiz = baixar(API % (repo, "master"), json_=True)
    if not raiz:
        return []
    sha = next((x["sha"] for x in raiz.get("tree", []) if x["path"] == "Named_Snaps"), None)
    if not sha:
        return []
    sub = baixar(API % (repo, sha), json_=True) or {}
    fs = [x["path"] for x in sub.get("tree", []) if x["path"].endswith(".png")]
    os.makedirs(CACHE, exist_ok=True)
    with open(local, "w", encoding="utf-8") as f:
        json.dump(fs, f)
    print("   %s: %d capturas no repositorio" % (repo, len(fs)))
    return fs


def escolher(cands):
    """Entre as versoes regionais, a da regiao preferida; depois, a primeira em
    ordem alfabetica, que da resultado igual toda vez que o coletor roda."""
    for r in REGIOES:
        no_r = sorted(c for c in cands if regiao_de(c) == r)
        if no_r:
            return no_r[0]
    return sorted(cands)[0]


def gravar(gid, png):
    """PNG cru -> WEBP com a mesma regua do fetch_screens.py. Grava num
    temporario e troca, senao uma interrupcao deixa imagem pela metade em disco,
    e o site nao tem como saber que aquele arquivo esta truncado."""
    im = Image.open(io.BytesIO(png)).convert("RGB")
    if im.width > LARGURA:
        im = im.resize((LARGURA, max(1, round(im.height * LARGURA / im.width))), Image.LANCZOS)
    dest = os.path.join(OUT, "%s-1.webp" % gid)
    tmp = dest + ".tmp"
    im.save(tmp, "WEBP", quality=QUALIDADE, method=6)
    os.replace(tmp, dest)
    return os.path.getsize(dest)


def um(tarefa):
    gid, repo, arquivo = tarefa
    dest = os.path.join(OUT, "%s-1.webp" % gid)
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock:
            stat["pulados"] += 1
        return True
    png = baixar(RAW % (repo, urllib.parse.quote(arquivo)))
    if not png:
        with lock:
            stat["falhas"] += 1
        return False
    try:
        n = gravar(gid, png)
    except Exception:
        with lock:
            stat["falhas"] += 1
        return False
    with lock:
        stat["ok"] += 1
        stat["bytes"] += n
    return True


def main():
    limite = 0
    if "--limite" in sys.argv:
        limite = int(sys.argv[sys.argv.index("--limite") + 1])
    refazer = "--refazer-lista" in sys.argv
    os.makedirs(OUT, exist_ok=True)

    emu = json.load(open(os.path.join(ROOT, "data", "emu.json"), encoding="utf-8"))
    xbox = json.load(open(os.path.join(ROOT, "data", "xbox.json"), encoding="utf-8"))
    if isinstance(xbox, dict):
        xbox = xbox.get("games", [])

    fila = []
    for sis, repo in REPOS.items():
        print("%s:" % sis, flush=True)
        fs = listar(repo, refazer)
        idx = {}
        for f in fs:
            idx.setdefault(sem_parenteses(f[:-4]), []).append(f)
        if sis == "xbox":
            jogos = xbox
        else:
            # ROM hack e homebrew nao estao nos thumbnails, e casar pelo titulo
            # do jogo original poria a captura do outro jogo na ficha errada
            jogos = [g for g in emu if g.get("system") == sis
                     and g.get("releaseType") == "Released"]
        achou = 0
        for g in jogos:
            cands = idx.get(norm(g.get("title", "")))
            if cands:
                fila.append((g["id"], repo, escolher(cands)))
                achou += 1
        print("   %d de %d jogos com captura" % (achou, len(jogos)))
        stat["sem_captura"] += len(jogos) - achou

    if limite:
        fila = fila[:limite]
    print("\nbaixando %d capturas com %d workers...\n" % (len(fila), WORKERS), flush=True)
    t0 = time.time()
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for i, _ in enumerate(ex.map(um, fila), 1):
            if i % 200 == 0 or i == len(fila):
                print("  %d/%d  novas=%d pulados=%d falhas=%d | %.1f MB | %.0f min"
                      % (i, len(fila), stat["ok"], stat["pulados"], stat["falhas"],
                         stat["bytes"] / 1048576, (time.time() - t0) / 60), flush=True)

    # screens.json e compartilhado com o coletor do Marketplace: aqui so entra
    # quem tem arquivo em disco, e o que ja estava la nao e mexido
    caminho = os.path.join(ROOT, "data", "screens.json")
    screens = json.load(open(caminho, encoding="utf-8")) if os.path.exists(caminho) else {}
    for gid, _, _ in fila:
        if os.path.exists(os.path.join(OUT, "%s-1.webp" % gid)):
            screens[gid] = max(screens.get(gid, 0), 1)
    jsonio.salvar(caminho, screens)
    print("\ndata/screens.json: %d jogos com captura (%d novos, %.1f MB baixados)"
          % (len(screens), stat["ok"], stat["bytes"] / 1048576))
    return 0


if __name__ == "__main__":
    sys.exit(main())
