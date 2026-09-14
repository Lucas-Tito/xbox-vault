#!/usr/bin/env python3
"""Resolucao nativa (e frame rate, se houver) da lista do forum Beyond3D.

Quase nenhum jogo de Xbox 360 rodava em 720p de verdade: Alan Wake sai em
960x544, Aliens vs Predator em 1120x630, Colonial Marines em 1152x640. Esse
numero nao existe em nenhuma outra base que o projeto usa, e muda a expectativa
de quem vai jogar mais do que metade dos campos que ja mostramos.

A fonte e a thread "list of rendering resolutions", lida das copias do Internet
Archive. O formato de cada linha e

    Alan Wake = 960x544
    Assassin's Creed = 1280x720 (QAA)
    Assassin's Creed 2 = 1280x720 (QAA), 960x720 (QAA) -> 1080 mode.

e a thread e dividida por console com cabecalhos soltos ("Xbox 360", "PS3",
"Wii U"). So a secao de Xbox 360 interessa -- casar resolucao de PS3 com jogo de
360 seria pior do que nao ter o campo.

Frame rate: esta thread NAO tem. O parser le mesmo assim, porque custa nada e
evita refazer tudo se aparecer fonte depois; hoje o campo sai sempre ausente.

Cobertura: 397 jogos na secao de 360. E lista de titulo notavel, nao catalogo.
"""
import html, json, os, re, sys, tempfile, time, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
CDX = ("https://web.archive.org/cdx/search/cdx?url=forum.beyond3d.com/threads/"
       "list-of-rendering-resolutions&matchType=prefix&output=json"
       "&filter=statuscode:200&limit=40")
# cabecalho solto que troca a secao; so o de 360 e aproveitado
SECAO = re.compile(r"^(xbox\s*360|x360|ps3|playstation\s*3|wii\s*u?|pc|ps4|xbox\s*one)\s*:?\s*$", re.I)
LINHA = re.compile(r"^(.{2,80}?)\s*=\s*(\d{3,4})\s*[xX×]\s*(\d{3,4})(.*)$")


def baixar(url, tries=3):
    delay = 3.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=60) as r:
                dados = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    import gzip
                    dados = gzip.decompress(dados)
                return dados.decode("utf-8", "replace")
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.8
    return None


ROMANO = {"i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5",
          "vi": "6", "vii": "7", "viii": "8", "ix": "9", "x": "10"}


def norm(s, romano=False):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("&", "and")
    if romano:
        # a thread escreve "Assassin's Creed 2" e o catalogo "Assassin's Creed II"
        s = re.sub(r"\b(i{1,3}|iv|vi{0,3}|ix|xi{0,2})\b",
                   lambda m: ROMANO.get(m.group(1), m.group(1)), s)
    return re.sub(r"[^a-z0-9]", "", s)


def casar(nome, exato, roman, prefixos):
    """Titulo da thread -> id nosso, do criterio mais seguro para o menos.

    O prefixo so vale quando ha UM candidato: a thread abrevia ("50 Cent" para
    "50 Cent: Blood on the Sand", "Call of Duty 4" para "... Modern Warfare"),
    mas "Halo" sozinho casaria com uma duzia de jogos e ai o certo e desistir.
    """
    i = exato.get(norm(nome))
    if i:
        return i
    i = roman.get(norm(nome, True))
    if i:
        return i
    # a thread usa ordem de catalogo em alguns titulos: "Club, The"
    inv = re.match(r"^(.*),\s*(The|A|An)$", nome, re.I)
    if inv:
        i = roman.get(norm("%s %s" % (inv.group(2), inv.group(1)), True))
        if i:
            return i
    base = norm(nome, True)
    if len(base) < 6:
        return None
    cand = [x for k, x in prefixos if k.startswith(base) and len(k) <= len(base) + 28]
    return cand[0] if len(cand) == 1 else None


def linhas_do_html(h):
    """O forum separa as entradas com <br>; virar tag em quebra preserva a lista."""
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    t = re.sub(r"(?s)<!--.*?-->", " ", t)
    t = re.sub(r"<br\s*/?>|</(p|div|li|tr|td)>", "\n", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return [re.sub(r"[ \t]+", " ", x).strip() for x in t.split("\n")]


def parse(h):
    fora = {}
    secao = None
    for l in linhas_do_html(h):
        m = SECAO.match(l)
        if m:
            s = m.group(1).lower().replace(" ", "")
            secao = "x360" if s in ("xbox360", "x360") else s
            continue
        if secao != "x360":
            continue
        e = LINHA.match(l)
        if not e:
            continue
        nome, larg, alt, resto = e.group(1).strip(), int(e.group(2)), int(e.group(3)), e.group(4)
        if not (240 <= larg <= 1920 and 180 <= alt <= 1080):
            continue
        reg = {"w": larg, "h": alt}
        # o parentese logo apos a resolucao costuma ser o anti-aliasing
        aa = re.match(r"\s*\(([^)]{1,40})\)", resto)
        if aa:
            reg["aa"] = aa.group(1).strip()
        # varias entradas trazem um segundo modo; guardar como observacao
        obs = resto[aa.end():].strip(" ,.;") if aa else resto.strip(" ,.;")
        if 2 < len(obs) < 120:
            reg["obs"] = obs
        # frame rate: esta lista nao tem, mas se aparecer numero seguido de fps,
        # entra sem precisar reescrever o coletor
        f = re.search(r"\b(\d{2,3})\s*fps\b", resto, re.I)
        if f and 10 <= int(f.group(1)) <= 120:
            reg["fps"] = int(f.group(1))
        fora.setdefault(nome, reg)
    return fora


def salvar(caminho, obj):
    d = os.path.dirname(caminho)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=0, sort_keys=True)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, caminho)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    raw = baixar(CDX)
    if not raw:
        raise SystemExit("nao consegui o indice do Internet Archive")
    caps = sorted(json.loads(raw)[1:], key=lambda r: r[1])
    print("capturas da thread: %d (%s a %s)" % (len(caps), caps[0][1][:8], caps[-1][1][:8]))

    # a mais recente costuma ser a mais completa, mas se ela vier truncada a
    # anterior salva a coleta -- por isso tenta em ordem decrescente
    achado = {}
    for r in reversed(caps):
        h = baixar("https://web.archive.org/web/%sid_/%s" % (r[1], r[2]))
        time.sleep(2.0)
        if not h:
            continue
        d = parse(h)
        print("  captura %s -> %d jogos de Xbox 360" % (r[1][:8], len(d)))
        if len(d) > len(achado):
            achado = d
        if len(achado) > 300:
            break
    if not achado:
        raise SystemExit("nenhuma captura trouxe a lista")

    jogos = json.load(open(os.path.join(ROOT, "data", "x360.json"), encoding="utf-8"))
    exato, roman = {}, {}
    for g in jogos:
        exato.setdefault(norm(g["title"]), g["id"])
        roman.setdefault(norm(g["title"], True), g["id"])
    prefixos = sorted(((norm(g["title"], True), g["id"]) for g in jogos),
                      key=lambda x: len(x[0]))

    out, perdidos = {}, []
    for nome, reg in achado.items():
        i = casar(nome, exato, roman, prefixos)
        if i:
            out[i] = reg
        else:
            perdidos.append(nome)
    salvar(os.path.join(ROOT, "data", "resolucao.json"), out)
    print("\nlista: %d jogos | casaram com o catalogo: %d | sem par: %d"
          % (len(achado), len(out), len(perdidos)))
    print("com frame rate: %d" % sum(1 for v in out.values() if v.get("fps")))
    print("exemplos sem par:", ", ".join(perdidos[:6]))
    print("-> data/resolucao.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
