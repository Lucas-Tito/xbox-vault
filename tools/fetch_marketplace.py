#!/usr/bin/env python3
"""Tamanho de download e lista de DLC, do Marketplace do Xbox 360 arquivado.

O Marketplace foi desligado em 2024, mas as paginas de produto ficaram no
Internet Archive. Cada uma tem uma secao "Products" cujo conteudo depende do
parametro DownloadType da URL:

    DownloadType=Game       o jogo completo   -> campo "Size:"
    DownloadType=GameAddon  os add-ons        -> lista de nomes
    DownloadType=GameDemo   a demo            -> ARMADILHA, ver abaixo

O tamanho daqui e o que interessa: e o download real (Killer is Dead, 4,50 GB),
nao a imagem de disco com padding do Redump, onde 98% dos jogos cairiam em 7,30
ou 8,14 GB porque o disco vai cheio de enchimento.

ARMADILHA: pegar o primeiro "Size:" da pagina traz a DEMO. A pagina do GoldenEye
Reloaded lista "All Game Demos ... Size: 921.48 MB" antes de qualquer outra
coisa, e 921 MB nao e o jogo. O parser ancora no cabecalho "All Games" e so
aceita o Size que vem depois dele.

O casamento e por Title ID, que ja temos em data/x360db.json.
"""
import html, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
PAUSA = 2.5          # 1,2s rendeu bloqueio do Archive; ver fetch_cooptimus.py
ALVOS = {"tamanho": ("Game", "tamanho.json"), "dlc": ("GameAddon", "dlc.json")}


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
        except urllib.error.HTTPError as e:
            if e.code == 404 or n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.7
    return None


def texto(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?s)<!--.*?-->", " ", h)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h)))


UNID = {"KB": 1 / 1048576.0, "MB": 1 / 1024.0, "GB": 1.0}


SECAO = re.compile(r"All Game Demos|All Game Add-?ons|All Games|All Videos|All Themes", re.I)


def ler_tamanho(h):
    """GB do jogo completo.

    Ha duas disposicoes de pagina: uma traz o cabecalho "All Games" antes da
    lista, a outra vai direto nos controles de ordenacao. Entao em vez de exigir
    o cabecalho, olhamos qual foi a ULTIMA secao declarada antes do "Size:" --
    se for de demo, add-on, video ou tema, o numero nao e do jogo e e descartado.
    Sem isso o GoldenEye Reloaded entraria com os 921 MB da demo.
    """
    t = texto(h)
    m = re.search(r"Size:\s*([\d.,]+)\s*(KB|MB|GB)", t, re.I)
    if not m:
        return None
    ultima = None
    for s in SECAO.finditer(t[:m.start()]):
        ultima = s.group(0).lower()
    if ultima and ultima != "all games":
        return None
    try:
        v = float(m.group(1).replace(",", ""))
    except ValueError:
        return None
    gb = v * UNID[m.group(2).upper()]
    return round(gb, 3) if 0 < gb < 60 else None


def ler_dlc(h):
    """Nomes dos add-ons listados, sem preco e sem endereco de compra."""
    t = texto(h)
    i = t.find("All Game Add-ons")
    if i < 0:
        i = t.find("All Game Addons")
    if i < 0:
        return None
    resto = t[i:]
    corte = re.search(r"All Games |All Game Demos|All Videos|All Themes", resto[16:])
    if corte:
        resto = resto[:corte.start() + 16]
    nomes = []
    for m in re.finditer(r"(?:^|\s)([A-Z][^|]{3,70}?)\s+(?:Sign in to rate|[\d.,]+ out of 5)", resto):
        nome = m.group(1).strip(" -–—")
        if 3 < len(nome) < 70 and nome not in nomes:
            nomes.append(nome)
    return nomes or None


def indice(tipo):
    """Title ID -> captura mais nova da pagina daquele DownloadType."""
    cp = os.path.join(CACHE, "marketplace-cdx.json")
    if os.path.exists(cp):
        with open(cp, encoding="utf-8") as f:
            bruto = json.load(f)
    else:
        url = ("https://web.archive.org/cdx/search/cdx?url=marketplace.xbox.com/en-US/Product/"
               "&matchType=prefix&output=json&filter=statuscode:200&collapse=urlkey&limit=400000")
        raw = baixar(url)
        if not raw:
            raise SystemExit("nao consegui o indice do Internet Archive")
        bruto = json.loads(raw)[1:]
        os.makedirs(CACHE, exist_ok=True)
        with open(cp, "w", encoding="utf-8") as f:
            json.dump(bruto, f)
    out = {}
    for r in bruto:
        m = re.search(r"d802([0-9a-fA-F]{8})", r[2])
        if not m or not re.search(r"DownloadType=%s(&|$)" % tipo, r[2], re.I):
            continue
        t = m.group(1).upper()
        if t not in out or r[1] > out[t][0]:
            out[t] = (r[1], r[2])
    return out


def main():
    alvo = sys.argv[1] if len(sys.argv) > 1 else "tamanho"
    if alvo not in ALVOS:
        print("uso: fetch_marketplace.py [tamanho|dlc] [limite]")
        return 2
    tipo, arq = ALVOS[alvo]
    limite = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 0

    with open(os.path.join(ROOT, "data", "x360db.json"), encoding="utf-8") as f:
        base = json.load(f)
    por_tid = {v["titleId"].upper(): k for k, v in base.items() if v.get("titleId")}

    idx = indice(tipo)
    saida = os.path.join(ROOT, "data", arq)
    dados = {}
    if os.path.exists(saida):
        with open(saida, encoding="utf-8") as f:
            dados = json.load(f)

    fila = [(por_tid[t], t, ts, u) for t, (ts, u) in idx.items()
            if t in por_tid and por_tid[t] not in dados]
    fila.sort(key=lambda x: -int(x[2]))
    print("paginas %s arquivadas: %d | casam e faltam: %d (ja feitos: %d)"
          % (tipo, len(idx), len(fila), len(dados)))
    if limite:
        fila = fila[:limite]

    ok = vazio = 0
    t0 = time.time()
    for i, (gid, tid, ts, url) in enumerate(fila, 1):
        h = baixar("https://web.archive.org/web/%sid_/%s" % (ts, url))
        time.sleep(PAUSA)
        v = (ler_tamanho(h) if alvo == "tamanho" else ler_dlc(h)) if h else None
        if v is None:
            if h is not None:
                dados[gid] = None       # pagina lida e sem o campo: nao repetir
                vazio += 1
        else:
            dados[gid] = v
            ok += 1
        if i % 25 == 0 or i == len(fila):
            with open(saida, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=0, sort_keys=True)
            print("  %d/%d  com dado=%d sem=%d  %.0f min"
                  % (i, len(fila), ok, vazio, (time.time() - t0) / 60), flush=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=0, sort_keys=True)
    print("\ndata/%s: %d com dado" % (arq, sum(1 for v in dados.values() if v)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
