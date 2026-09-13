#!/usr/bin/env python3
"""Le os dados de co-op do Co-Optimus e grava em data/coop.json.

O Co-Optimus e um catalogo mantido a mao, so de jogo com co-op, e diz o que
nenhuma outra fonte diz: quantos jogadores em cada modalidade (local, online,
combo, system link), se a campanha inteira e jogavel junto ou se e um modo
separado, e um paragrafo descrevendo como o co-op funciona.

O site esta atras de um desafio da Cloudflare, entao a leitura e feita pelas
copias do Internet Archive -- que sao publicas, nao batem no servidor deles e
nao contornam protecao nenhuma.

DOIS CUIDADOS QUE CUSTARAM DADO ERRADO:

1. O servidor do Co-Optimus roteia SO PELO ID. O segmento de plataforma e o
   slug do endereco sao decorativos: /game/20/pc/halo-2.html devolve a pagina do
   Gears of War para PC, e /game/1217/xbox-360/brink.html devolve a do Brink de
   PlayStation 3. Por isso a familia e decidida pelo que a PAGINA diz de si
   ("Co-Op Features in the Xbox 360 Version"), nunca pelo endereco.

2. O CDX do Internet Archive casa prefixo depois de canonicalizar, e a barra
   final some: pedir /game/1044/ tambem casa /game/10449/. Somado a "limit=-3",
   que ordena por urlkey e nao por tempo, isso fazia o Guitar Hero II receber os
   numeros do SpellForce 3. O id exato e filtrado no cliente.

Ha tres geracoes de layout. A de 2013+ diz "Co-Op Features in the X Version"; a
de 2009-2012 diz "Co-Op Features of <jogo> <sistema>" e usa outros rotulos; a
anterior a 2009 nao tem bloco estruturado e e descartada.
"""
import html, json, os, re, sys, time, unicodedata, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
# 1,2 s durante oito horas levou a um bloqueio do Internet Archive (recusa de
# conexao, HTTP 000, por varias horas). Com 2,5 s a coleta demora o dobro mas
# nao esbarra no limite deles.
PAUSA = 2.5
VERSAO = 2          # muda quando o parser muda: entradas antigas sao refeitas

# O que a PROPRIA pagina se diz -> de onde o jogo tem de vir no nosso catalogo.
FAMILIA_DA_PAGINA = [
    (r"xbox 360", "x360"),
    (r"xbox live arcade", "x360"),
    (r"xbox live indie games", "xblig"),
    (r"xbox", "xbox"),
    (r"snes( \[classics\])?", "emu:SNES"),
    (r"super nintendo( \[classics\])?", "emu:SNES"),
    (r"playstation( \[classics\])?", "emu:PS1"),
    (r"gameboy advanced?( \[classics\])?", "emu:GBA"),
    (r"game boy advanced?( \[classics\])?", "emu:GBA"),
]
# System Link num portatil/console de cartucho e cabo, ou seja, co-op LOCAL.
# Nas familias de emulacao o Co-Optimus usa "LAN or System Link" para o cabo
# link do GBA e marca "Local Co-Op: Not Supported" -- tratar isso como online
# anunciaria um cartucho de GBA como jogo pela internet.
LAN_E_LOCAL = {"emu:SNES", "emu:PS1", "emu:GBA"}


def familia_da_pagina(sistema):
    s = (sistema or "").strip().lower()
    for rx, fam in FAMILIA_DA_PAGINA:
        if re.fullmatch(rx, s):
            return fam
    return None


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


def baixar(url, tries=3):
    """Devolve (html, data_da_captura) -- a data real, lida do cabecalho."""
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
                # o Memento-Datetime diz de quando e a captura que veio mesmo,
                # que nem sempre e a que o endereco pediu
                quando = ""
                mem = r.headers.get("Memento-Datetime") or ""
                m = re.search(r"(\d{2}) (\w{3}) (\d{4})", mem)
                if m:
                    meses = dict(Jan="01", Feb="02", Mar="03", Apr="04", May="05",
                                 Jun="06", Jul="07", Aug="08", Sep="09", Oct="10",
                                 Nov="11", Dec="12")
                    quando = m.group(3) + meses.get(m.group(2), "01") + m.group(1)
                if not quando:
                    m = re.search(r"/web/(\d{8})", r.geturl() or "")
                    quando = m.group(1) if m else ""
                return dados.decode("utf-8", "replace"), quando
        except Exception:
            if n == tries - 1:
                return None, ""
            time.sleep(delay); delay *= 1.8
    return None, ""


def texto(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?s)<!--.*?-->", " ", h)      # antes das tags: o <[^>]+> vaza comentario
    h = html.unescape(re.sub(r"<[^>]+>", " ", h))   # unescape ANTES de colapsar,
    return re.sub(r"\s+", " ", h)                   # senao &nbsp; vira \xa0 solto


# --- layout de 2013 em diante -------------------------------------------------
NOVO_NUM = [("local", r"Local Co-Op[: ]+(\d+)\s*Players?"),
            ("online", r"Online Co-Op[: ]+(\d+)\s*Players?"),
            # "4 Players" e tambem "Up to 2 Local or Online"
            ("combo", r"Combo Co-Op \(Local \+ Online\)[: ]+(?:Up to )?(\d+)\s*(?:Players?|Local)"),
            ("lan", r"LAN Play or System Link[: ]+(\d+)\s*Players?")]
NOVO_NAO = [("local", r"Local Co-Op[: ]+Not Supported"),
            ("online", r"Online Co-Op[: ]+Not Supported"),
            ("combo", r"Combo Co-Op \(Local \+ Online\)[: ]+Not Supported"),
            ("lan", r"LAN Play or System Link[: ]+Not Supported")]

# --- layout de 2009 a 2012 ----------------------------------------------------
VELHO_NUM = [("local", r"Number of Players Offline[: ]+(\d+)"),
             ("online", r"Number of Players Online[: ]+(\d+)"),
             ("combo", r"Number of Players Online with Local[: ]+(\d+)"),
             ("lan", r"Number of Players via LAN or System link[: ]+(\d+)")]

EXTRAS_RX = (r"(Co-Op Campaign|Co-Op Specific Content|Drop[- ]?In ?/ ?Drop[- ]?Out|"
             r"Downloadable Only|Split[- ]?screen|Online Play|Co-Op Modes?|"
             r"Local Play|Bots|Friendly Fire|Import)")


def _janela(t, inicio, fins):
    """Trecho entre um rotulo e o proximo, sem atravessar o terminador.

    O (.*?) simples nao casa vazio depois de consumir o espaco obrigatorio, entao
    numa secao vazia ele pulava por cima do terminador e engolia o paragrafo
    seguinte inteiro.
    """
    alt = "|".join(fins)
    # o rotulo vem "The Co-Op Experience" no layout novo e "The Co-Op
    # Experience:" no antigo -- os dois-pontos sao opcionais
    m = re.search(r"%s:? ((?:(?!%s).)*?) (?:%s):? " % (inicio, alt, alt), t)
    return m.group(1).strip() if m else None


def parse(h):
    t = texto(h)
    novo = "Co-Op Features in the" in t
    velho = "Co-Op Features of" in t
    if not novo and not velho:
        return None                      # anterior a 2009, sem bloco estruturado
    out = {}
    if novo:
        for k, rx in NOVO_NUM:
            m = re.search(rx, t, re.I)
            if m:
                out[k] = int(m.group(1))
        for k, rx in NOVO_NAO:
            if k not in out and re.search(rx, t, re.I):
                out[k] = 0
        m = re.search(r"Co-Op Features in the (.{2,40}?) Version", t)
        if m:
            out["sistema"] = m.group(1).strip()
        fins_exp = ["Description", "Best Prices", "Release Date"]
    else:
        for k, rx in VELHO_NUM:
            m = re.search(rx, t, re.I)
            if m:
                out[k] = int(m.group(1))
        # "Co-Op Features of Call of Juarez: The Cartel 360" -- o sistema e o rabo
        m = re.search(r"Co-Op Features of (.{2,80}?) (Local Co-Op|$)", t)
        if m:
            out["sistema"] = _sistema_do_titulo(m.group(1).strip())
        fins_exp = ["Background", "Description", "Best Prices", "Release Date"]

    bruto = _janela(t, "Co-Op Extras", ["The Co-Op Experience", "Description"])
    if bruto:
        vistos, lim = [], []
        for i in re.findall(EXTRAS_RX, bruto, re.I):
            if i.lower() not in vistos:
                vistos.append(i.lower()); lim.append(i)
        if lim:
            out["extras"] = lim
    elif velho:
        # no layout antigo cada caracteristica e uma linha "Rotulo: Yes/No"
        lim = []
        for rot, nome in [("Splitscreen", "Splitscreen"),
                          ("Drop-In / Drop-Out", "Drop-In / Drop-Out"),
                          ("Co-Op Specific Content", "Co-Op Specific Content"),
                          ("Co-Op Campaign", "Co-Op Campaign")]:
            if re.search(re.escape(rot) + r"[: ]+Yes", t, re.I):
                lim.append(nome)
        if lim:
            out["extras"] = lim

    exp = _janela(t, "The Co-Op Experience", fins_exp)
    if exp:
        exp = re.sub(r"^The Co-Op Experience:?\s*", "", exp).strip()
        if 15 < len(exp) < 700:
            out["exp"] = exp
    if not any(k in out for k in ("local", "online", "combo", "lan")):
        return None
    return out


def _sistema_do_titulo(s):
    """No layout antigo o sistema vem grudado no fim do titulo do bloco."""
    for rabo, nome in [(r"360$", "Xbox 360"), (r"xbla$", "Xbox Live Arcade"),
                       (r"xbox$", "Xbox"), (r"snes$", "SNES"),
                       (r"psx$", "Playstation"), (r"gba$", "GameBoy Advance"),
                       (r"pc$", "PC"), (r"ps3$", "Playstation 3"),
                       (r"wii$", "Wii"), (r"ds$", "DS")]:
        if re.search(rabo, s, re.I):
            return nome
    return s


def indice():
    """id do Co-Optimus -> (slugs vistos, timestamp mais novo, url mais nova).

    O segmento de plataforma e ignorado de proposito: ele mente. Guardamos todos
    os slugs porque o titulo do jogo so aparece ali antes de baixar a pagina.
    """
    cp = os.path.join(CACHE, "cooptimus-cdx-v2.json")
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as f:
            return json.load(f)
    url = ("https://web.archive.org/cdx/search/cdx?url=www.co-optimus.com/game/"
           "&matchType=prefix&output=json&filter=statuscode:200&collapse=urlkey&limit=40000")
    raw, _ = baixar(url)
    if not raw:
        raise SystemExit("nao consegui o indice do Internet Archive")
    jogos = {}
    for r in json.loads(raw)[1:]:
        m = re.search(r"/game/(\d+)/[^/]+/([^/?]+)\.html", r[2])
        if not m:
            continue
        gid = m.group(1)
        slug = re.sub(r"[_\-]+", " ", urllib.parse.unquote(m.group(2)))
        e = jogos.setdefault(gid, {"slugs": [], "ts": "", "url": ""})
        if slug not in e["slugs"]:
            e["slugs"].append(slug)
        if r[1] > e["ts"]:
            e["ts"], e["url"] = r[1], r[2]
    os.makedirs(CACHE, exist_ok=True)
    with open(cp, "w", encoding="utf-8") as f:
        json.dump(jogos, f)
    return jogos


def mais_nova_por_id(cid):
    """Captura mais recente de um jogo, filtrando o id EXATO.

    O CDX canonicaliza antes de casar o prefixo e a barra final some, entao
    /game/1044/ tambem casa /game/10449/. E "limit=-3" ordena por urlkey, nao
    por tempo. Sem filtrar aqui, o Guitar Hero II recebe o SpellForce 3.
    """
    raw, _ = baixar("https://web.archive.org/cdx/search/cdx?url=www.co-optimus.com/game/"
                    "%s/&matchType=prefix&output=json&filter=statuscode:200&limit=300" % cid)
    if not raw:
        return None
    try:
        linhas = json.loads(raw)[1:]
    except ValueError:
        return None
    meus = [r for r in linhas if re.search(r"/game/%s/" % re.escape(cid), r[2])]
    return max(meus, key=lambda r: r[1])[2] if meus else None


def catalogo():
    """(familia, titulo normalizado) -> id nosso. Cada familia no seu espaco."""
    m = {}
    for arq, fam in (("x360.json", "x360"), ("xblig.json", "xblig"),
                     ("xbox.json", "xbox")):
        for g in json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8")):
            m.setdefault((fam, norm(g["title"])), g["id"])
    for g in json.load(open(os.path.join(ROOT, "data", "emu.json"), encoding="utf-8")):
        m.setdefault(("emu:" + g["system"], norm(g["title"])), g["id"])
    return m


def main():
    limite = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 0
    refazer = "--refazer" in sys.argv
    jogos = indice()
    nossos = catalogo()
    titulos = {}
    for (fam, t), i in nossos.items():
        titulos.setdefault(t, set()).add(fam)
    print("ids do Co-Optimus arquivados: %d" % len(jogos))

    saida = os.path.join(ROOT, "data", "coop.json")
    dados = {}
    if os.path.exists(saida) and not refazer:
        with open(saida, encoding="utf-8") as f:
            dados = json.load(f)
        # o que foi gravado por um parser mais velho volta para a fila
        dados = {k: v for k, v in dados.items() if v.get("v") == VERSAO}

    # Pre-filtro barato: so vale baixar se algum slug casa com algum titulo
    # nosso. A familia certa so da para saber depois, lendo a pagina -- por isso
    # aqui listamos TODOS os jogos nossos a que este id poderia corresponder.
    def possiveis(e):
        out = set()
        for sl in e["slugs"]:
            t = norm(sl)
            for fam in titulos.get(t, ()):
                i = nossos.get((fam, t))
                if i:
                    out.add(i)
        return out

    fila, pulados = [], 0
    for cid, e in jogos.items():
        poss = possiveis(e)
        if not poss:
            continue
        # So pula quando TUDO que este id poderia preencher ja esta coletado.
        # Sem isso o coletor refaz os 2.848 a cada reinicio, porque o teste
        # contra o que ja existe so acontecia depois de baixar a pagina.
        if poss <= set(dados):
            pulados += 1
            continue
        fila.append((cid, e["ts"], e["url"]))
    fila.sort(key=lambda x: -int(x[1]))
    print("candidatos: %d na fila, %d ja coletados e pulados" % (len(fila), pulados))
    if limite:
        fila = fila[:limite]

    ok = fora = vazio = 0
    t0 = time.time()
    for i, (cid, ts, url) in enumerate(fila, 1):
        d = quando = None
        for tentativa in ("https://web.archive.org/web/2024id_/%s" % url,
                          None,
                          "https://web.archive.org/web/%sid_/%s" % (ts, url)):
            if tentativa is None:
                alt = mais_nova_por_id(cid)
                tentativa = ("https://web.archive.org/web/2024id_/%s" % alt) if alt else None
                if not tentativa:
                    continue
            h, quando = baixar(tentativa)
            time.sleep(PAUSA)
            d = parse(h) if h else None
            if d:
                break

        if not d:
            vazio += 1
        else:
            # a pagina diz de que versao ela fala; o endereco nao vale nada
            fam = familia_da_pagina(d.get("sistema"))
            nosso = nossos.get((fam, norm(_titulo_da_pagina(d, jogos[cid]["slugs"])))) if fam else None
            if not nosso:
                for s in jogos[cid]["slugs"]:
                    nosso = nossos.get((fam, norm(s))) if fam else None
                    if nosso:
                        break
            if not nosso:
                fora += 1
            else:
                d["fonte"] = "https://www.co-optimus.com/game/%s/" % cid
                d["snapshot"] = (quando or ts)[:8]
                d["v"] = VERSAO
                velho = dados.get(nosso)
                # nunca deixar uma leitura pior apagar uma boa
                if not velho or len(d) >= len(velho):
                    dados[nosso] = d
                ok += 1
        if i % 25 == 0 or i == len(fila):
            with open(saida, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
            print("  %d/%d  casou=%d outra-plataforma=%d sem-bloco=%d  %.0fs"
                  % (i, len(fila), ok, fora, vazio, time.time() - t0), flush=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("\ndata/coop.json: %d jogos" % len(dados))
    return 0


def _titulo_da_pagina(d, slugs):
    return slugs[0] if slugs else ""


if __name__ == "__main__":
    sys.exit(main())
