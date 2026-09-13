#!/usr/bin/env python3
"""Le os dados de co-op do Co-Optimus e grava em data/coop.json.

O Co-Optimus e um catalogo mantido a mao, so de jogo com co-op, e diz o que
nenhuma outra fonte diz: quantos jogadores em cada modalidade, se a campanha
inteira e jogavel junto ou se e um modo separado, e um paragrafo descrevendo
como o co-op funciona.

O site esta atras de um desafio da Cloudflare, entao a leitura e feita pelas
copias do Internet Archive -- que sao publicas, nao batem no servidor deles e
nao contornam protecao nenhuma. O preco e que o dado tem a data do snapshot.

O casamento e por titulo normalizado. Quem nao esta la fica como esta: a
ausencia no Co-Optimus nao significa "nao tem co-op", significa que ninguem
catalogou.
"""
import html, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
PAUSA = 1.2
# Sistema do Co-Optimus -> de onde o jogo tem de vir no nosso catalogo.
# "emu:SNES" quer dizer: casar SO contra entradas de SNES em emu.json, senao um
# "Contra" de SNES casaria com o "Contra" de PlayStation.
SISTEMAS = [
    (r"xbox[ _+-]*360$", "xbox"),
    (r"xbox[ _+-]*live[ _+-]*arcade", "xbox"),
    (r"xbox[ _+-]*live[ _+-]*indie[ _+-]*games$", "xbox"),
    (r"xbox$", "xbox"),
    (r"(classics?[ _+-]*)?snes$", "emu:SNES"),
    (r"(classics?[ _+-]*)?super[ _+-]*nintendo$", "emu:SNES"),
    (r"(classics?[ _+-]*)?playstation$", "emu:PS1"),
    (r"(classics?[ _+-]*)?game[ _+-]*boy[ _+-]*advanced?$", "emu:GBA"),
]


def familia(sis):
    """'xbox', 'emu:SNES', ... ou None se o sistema nao nos interessa."""
    txt = urllib.parse.unquote(sis).replace("+", " ").replace("_", " ").strip().lower()
    for rx, fam in SISTEMAS:
        if re.fullmatch(rx, txt, re.I):
            return fam
    return None


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


def baixar(url, tries=3):
    delay = 2.0
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


def texto(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", h)))


NUM = [("local", r"Local Co-Op[: ]+(\d+)\s*Players?"),
       ("online", r"Online Co-Op[: ]+(\d+)\s*Players?"),
       # aparece como "4 Players" e tambem como "Up to 2 Local or Online"
       ("combo", r"Combo Co-Op \(Local \+ Online\)[: ]+(?:Up to )?(\d+)\s*(?:Players?|Local)"),
       ("lan", r"LAN Play or System Link[: ]+(\d+)\s*Players?")]
NAO = [("local", r"Local Co-Op[: ]+Not Supported"),
       ("online", r"Online Co-Op[: ]+Not Supported"),
       ("combo", r"Combo Co-Op \(Local \+ Online\)[: ]+Not Supported"),
       ("lan", r"LAN Play or System Link[: ]+Not Supported")]


def parse(h):
    t = texto(h)
    if "Co-Op Features in the" not in t:
        return None                      # layout antigo demais ou pagina de erro
    out = {}
    for k, rx in NUM:
        m = re.search(rx, t, re.I)
        if m:
            out[k] = int(m.group(1))
    for k, rx in NAO:
        if k not in out and re.search(rx, t, re.I):
            out[k] = 0
    # "Co-Op Extras" lista as caracteristicas: Co-Op Campaign, Drop In/Drop Out...
    m = re.search(r"Co-Op Extras (.*?) (?:The Co-Op Experience|Description) ", t)
    if m:
        bruto = m.group(1).strip()
        itens = re.findall(r"(Co-Op Campaign|Co-Op Specific Content|Drop In ?/ ?Drop Out|"
                           r"Downloadable Only|Split[- ]?screen|Online Play|"
                           r"Co-Op Modes?|Local Play|Bots|Friendly Fire)", bruto, re.I)
        vistos, lim = [], []
        for i in itens:
            c = i.strip()
            if c.lower() not in vistos:
                vistos.append(c.lower()); lim.append(c)
        if lim:
            out["extras"] = lim
    m = re.search(r"The Co-Op Experience (.*?) (?:Description|Best Prices|Release Date) ", t)
    if m:
        exp = re.sub(r"^The Co-Op Experience:?\s*", "", m.group(1).strip())
        if 15 < len(exp) < 700:
            out["exp"] = exp
    # A pagina diz de que versao sao os dados. Se nao for a que o endereco
    # prometia, e outra plataforma e os numeros nao valem para nos.
    m = re.search(r"Co-Op Features in the (.{2,40}?) Version", t)
    if m:
        out["sistema"] = m.group(1).strip()
    if not any(k in out for k in ("local", "online", "combo", "lan")):
        return None
    return out


def indice():
    """(id, sistema, slug, url) de cada pagina de jogo arquivada nos nossos sistemas."""
    cp = os.path.join(CACHE, "cooptimus-cdx.json")
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as f:
            return json.load(f)
    url = ("https://web.archive.org/cdx/search/cdx?url=www.co-optimus.com/game/"
           "&matchType=prefix&output=json&filter=statuscode:200&collapse=urlkey&limit=40000")
    raw = baixar(url)
    if not raw:
        raise SystemExit("nao consegui o indice do Internet Archive")
    linhas = json.loads(raw)[1:]
    jogos = {}
    for r in linhas:
        m = re.search(r"/game/(\d+)/([^/]+)/([^/?]+)\.html", r[2])
        if not m:
            continue
        fam = familia(m.group(2))
        if not fam:
            continue
        gid, slug = m.group(1), re.sub(r"[_\-]+", " ", m.group(3))
        # Guarda o snapshot mais novo. A chave inclui a familia porque o mesmo
        # jogo pode estar catalogado em Xbox 360 e em PlayStation classico, e
        # cada versao tem numeros proprios.
        chave = gid + "|" + fam
        if chave not in jogos or r[1] > jogos[chave][3]:
            jogos[chave] = (gid, fam, slug, r[1], r[2])
    os.makedirs(CACHE, exist_ok=True)
    with open(cp, "w", encoding="utf-8") as f:
        json.dump(jogos, f)
    return jogos


def mais_nova_por_id(cid):
    """Endereco arquivado mais recente de um jogo, procurando pelo id."""
    raw = baixar("https://web.archive.org/cdx/search/cdx?url=www.co-optimus.com/game/"
                 "%s/&matchType=prefix&output=json&filter=statuscode:200&limit=-3" % cid)
    if not raw:
        return None
    try:
        linhas = json.loads(raw)[1:]
    except ValueError:
        return None
    return linhas[-1][2] if linhas else None


def main():
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    jogos = indice()
    print("paginas do Co-Optimus nos nossos sistemas: %d" % len(jogos))

    # Xbox: chave e so o titulo. Emulacao: titulo + sistema, senao o "Contra"
    # de SNES casaria com o de PlayStation.
    nossos = {}
    for arq in ("x360.json", "xblig.json", "xbox.json"):
        for g in json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8")):
            nossos.setdefault("xbox|" + norm(g["title"]), g["id"])
    for g in json.load(open(os.path.join(ROOT, "data", "emu.json"), encoding="utf-8")):
        nossos.setdefault("emu:%s|%s" % (g["system"], norm(g["title"])), g["id"])

    saida = os.path.join(ROOT, "data", "coop.json")
    dados = {}
    if os.path.exists(saida):
        with open(saida, encoding="utf-8") as f:
            dados = json.load(f)

    fila = []
    for (cid, fam, slug, ts, url) in jogos.values():
        nosso = nossos.get(fam + "|" + norm(slug))
        if nosso and nosso not in dados:
            fila.append((nosso, cid, ts, url))
    print("casam com o catalogo e ainda sem dado: %d (ja tinha: %d)" % (len(fila), len(dados)))
    if limite:
        fila = fila[:limite]

    ok = vazio = 0
    t0 = time.time()
    for i, (nosso, cid, ts, url) in enumerate(fila, 1):
        # "2024id_" cai na captura mais proxima dessa data, que e a mais recente.
        # O indice do CDX vem colapsado por urlkey e entrega a captura mais ANTIGA
        # de cada endereco -- e o layout de 2008/2010 nao tem o bloco estruturado.
        h = baixar("https://web.archive.org/web/2024id_/%s" % url)
        time.sleep(PAUSA)
        d = parse(h) if h else None
        if not d:
            # endereco antigo (XBox_360 em vez de xbox-360): procurar por id
            alt = mais_nova_por_id(cid)
            if alt and alt != url:
                h = baixar("https://web.archive.org/web/2024id_/%s" % alt)
                time.sleep(PAUSA)
                d = parse(h) if h else None
        if not d:
            # sem captura perto de 2024: usar a que o indice conhece
            h = baixar("https://web.archive.org/web/%sid_/%s" % (ts, url))
            time.sleep(PAUSA)
            d = parse(h) if h else None
        if d:
            d["fonte"] = "https://www.co-optimus.com/game/%s/" % cid
            d["snapshot"] = ts[:8]
            dados[nosso] = d
            ok += 1
        else:
            # marca para nao repetir: layout antigo ou pagina sem o bloco
            dados[nosso] = {"sem_dado": True, "snapshot": ts[:8]}
            vazio += 1
        if i % 25 == 0 or i == len(fila):
            with open(saida, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
            print("  %d/%d  com dado=%d sem=%d  %.0fs"
                  % (i, len(fila), ok, vazio, time.time() - t0), flush=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("\ntotal em data/coop.json: %d (%d com dado util)"
          % (len(dados), sum(1 for v in dados.values() if not v.get("sem_dado"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
