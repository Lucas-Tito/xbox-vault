"""Helpers compartilhados para extrair dados da Wikipedia (MediaWiki API).

Todos os agentes DEVEM usar este modulo para garantir schema e cache consistentes.
Cache em disco: cache/  (nunca refetch do que ja foi baixado).
"""
import json, os, re, shutil, sys, tempfile, time, urllib.parse, urllib.request, hashlib

UA = "XbxListBuilder/1.0 (lucas.tito@virtual360.io) python-urllib"
API = "https://en.wikipedia.org/w/api.php"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "cache")
os.makedirs(CACHE, exist_ok=True)


def _cache_path(key):
    return os.path.join(CACHE, hashlib.sha1(key.encode()).hexdigest() + ".json")


def api(params, ttl_days=30):
    """GET na API com cache em disco e retry."""
    params = dict(params)
    params.setdefault("format", "json")
    params.setdefault("formatversion", "2")
    key = urllib.parse.urlencode(sorted(params.items()))
    cp = _cache_path(key)
    if os.path.exists(cp):
        try:
            with open(cp) as f:
                return json.load(f)
        except Exception:
            pass
    url = API + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            with open(cp, "w") as f:
                json.dump(data, f)
            return data
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("API falhou para %s: %s" % (url[:200], last))


def fetch_wikitext(page):
    """Wikitext bruto de UMA pagina."""
    d = api({"action": "parse", "prop": "wikitext", "page": page})
    return d["parse"]["wikitext"]


def _chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def batch_wikitext(titles):
    """{titulo_pedido: wikitext} para muitos artigos. Resolve redirects. 50 por request."""
    out = {}
    for chunk in _chunks(titles, 50):
        d = api({"action": "query", "prop": "revisions", "rvprop": "content",
                 "rvslots": "main", "redirects": "1", "titles": "|".join(chunk)})
        q = d.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        by_title = {}
        for p in q.get("pages", []):
            try:
                by_title[p["title"]] = p["revisions"][0]["slots"]["main"]["content"]
            except Exception:
                pass
        for t in chunk:
            resolved = redir.get(norm.get(t, t), norm.get(t, t))
            if resolved in by_title:
                out[t] = by_title[resolved]
    return out


def batch_images(titles, size=400):
    """{titulo_pedido: url_da_capa} usando pageimages (capa/box art do artigo)."""
    out = {}
    for chunk in _chunks(titles, 50):
        # pilimit=1 e pilicense=free sao os DEFAULTS e estao errados aqui: o primeiro
        # devolve imagem de uma pagina so por request, o segundo descarta capas de jogo
        # (nao-livres, usadas sob fair use). Sem isso vinham ~10 capas em vez de ~900.
        d = api({"action": "query", "prop": "pageimages", "piprop": "thumbnail|original",
                 "pithumbsize": str(size), "pilimit": "50", "pilicense": "any",
                 "redirects": "1", "titles": "|".join(chunk)})
        q = d.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        by_title = {}
        for p in q.get("pages", []):
            th = p.get("thumbnail", {}).get("source")
            if th:
                by_title[p["title"]] = th
        for t in chunk:
            resolved = redir.get(norm.get(t, t), norm.get(t, t))
            if resolved in by_title:
                out[t] = by_title[resolved]
    return out


# ---------- parsing de wikitext ----------

def strip_wiki(s):
    """Limpa markup: [[a|b]] -> b, ''x'' -> x, refs, tags, templates simples."""
    if not s:
        return ""
    s = re.sub(r"<ref[^>]*?/>", "", s)
    s = re.sub(r"<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"\{\{(?:hlist|plainlist|ubl|unbulleted list)\|(.*?)\}\}",
               lambda m: ", ".join(m.group(1).split("|")), s, flags=re.S | re.I)
    s = re.sub(r"\{\{nowrap\|(.*?)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"</?[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = s.replace("&nbsp;", " ").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip(" ,;|")


def link_target(cell):
    """De uma celula de tabela, extrai o titulo do artigo na Wikipedia ([[Alvo|Texto]] -> Alvo)."""
    m = re.search(r"\[\[([^\]|#]+)", cell or "")
    return m.group(1).strip() if m else None


def parse_dts(cell):
    """{{dts|2009|Dec|23}} -> (2009, '2009-12-23'). Retorna (None, None) se nao houver."""
    m = re.search(r"\{\{dts\|(\d{4})\|(\w+)\|?(\d{1,2})?", cell or "", re.I)
    if not m:
        m2 = re.search(r"\b(19[89]\d|20[0-2]\d)\b", cell or "")
        return (int(m2.group(1)), None) if m2 else (None, None)
    year = int(m.group(1))
    months = {m_: i + 1 for i, m_ in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
    mo = months.get(m.group(2)[:3].lower())
    day = m.group(3)
    iso = "%04d-%02d-%02d" % (year, mo, int(day)) if mo and day else (
        "%04d-%02d" % (year, mo) if mo else str(year))
    return year, iso


def iter_table_rows(wikitext, table_id="softwarelist"):
    """Itera linhas de uma tabela wikitable, devolvendo lista de celulas cruas.

    Limites de tabela, separadores de linha e de celula sao detectados apenas em
    profundidade zero: um "|}" dentro de {{dts|2002|Nov|}} NAO fecha a tabela
    (esse bug truncava a lista mestra do Xbox em 844 de 989 linhas).
    """
    wikitext = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    i = wikitext.find('id="%s"' % table_id)
    if i < 0:
        i = wikitext.find("{|")
    start = wikitext.rfind("{|", 0, i + 2)  # +2: a janela precisa conter o "{|" inteiro
    if start < 0:
        return

    def walk(text, pos, on_token):
        """Percorre o texto rastreando profundidade de {{ }} e [[ ]]."""
        dt = dl = 0
        while pos < len(text):
            if text.startswith("{{", pos): dt += 1; pos += 2; continue
            if text.startswith("}}", pos): dt = max(0, dt - 1); pos += 2; continue
            if text.startswith("[[", pos): dl += 1; pos += 2; continue
            if text.startswith("]]", pos): dl = max(0, dl - 1); pos += 2; continue
            step = on_token(text, pos, dt == 0 and dl == 0)
            if step is None:
                return pos
            pos += step
        return pos

    depth = [0]

    def table_scan(t, k, top):
        if top:
            if t.startswith("{|", k):
                depth[0] += 1; return 2
            if t.startswith("|}", k):
                depth[0] -= 1
                return None if depth[0] == 0 else 2
        return 1

    end = walk(wikitext, start, table_scan)
    body = wikitext[start:end]

    # separa linhas em "\n|-" de topo
    breaks = []

    def row_scan(t, k, top):
        if top and t.startswith("\n|-", k):
            breaks.append(k); return 3
        return 1

    walk(body, 0, row_scan)
    breaks.append(len(body))

    for bi in range(len(breaks) - 1):
        row = body[breaks[bi]:breaks[bi + 1]]
        cells, cur = [], ""
        pos, dt, dl = 0, 0, 0
        while pos < len(row):
            if row.startswith("{{", pos): dt += 1; cur += "{{"; pos += 2; continue
            if row.startswith("}}", pos): dt = max(0, dt - 1); cur += "}}"; pos += 2; continue
            if row.startswith("[[", pos): dl += 1; cur += "[["; pos += 2; continue
            if row.startswith("]]", pos): dl = max(0, dl - 1); cur += "]]"; pos += 2; continue
            if dt == 0 and dl == 0:
                if row.startswith("||", pos):
                    cells.append(cur); cur = ""; pos += 2; continue
                if row.startswith("\n|", pos) or row.startswith("\n!", pos):
                    cells.append(cur); cur = ""; pos += 2
                    if row.startswith("scope=row", pos):
                        pos += len("scope=row")
                        while pos < len(row) and row[pos] in " |":
                            pos += 1
                    continue
            cur += row[pos]; pos += 1
        cells.append(cur)
        cells = [c.strip() for c in cells]
        while cells and cells[0] in ("", "-"):
            cells = cells[1:]
        if not cells or re.match(r"^(rowspan|colspan|scope=col|style=|class=|width=|align=)", cells[0]):
            continue
        yield cells


def save(path, obj, force=False):
    """Grava JSON de forma ATOMICA e recusa encolhimento brusco.

    open(...,"w") trunca o arquivo ANTES de o conteudo novo existir: um erro no
    meio do dump deixa JSON quebrado e sem backup. E um script que monte a lista
    parcial sobrescreve a completa sem avisar -- foi assim que 535 notas do
    Metacritic se perderam. Aqui: escreve em temporario, valida tamanho, troca
    com os.replace (atomico) e guarda .bak.
    """
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    if os.path.exists(full) and not force and "--force" not in sys.argv:
        try:
            with open(full, encoding="utf-8") as f:
                antigo = json.load(f)
            if len(obj) < len(antigo) * 0.9:
                raise SystemExit(
                    "RECUSADO: %s tem %d itens e o novo so %d (queda de %.0f%%). "
                    "Se for intencional, rode com --force." %
                    (path, len(antigo), len(obj), 100 - len(obj) / len(antigo) * 100))
        except (ValueError, TypeError):
            pass
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(full), prefix=".tmp-save-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.flush()
            os.fsync(f.fileno())
        if os.path.exists(full):
            shutil.copy2(full, full + ".bak")
        os.replace(tmp, full)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    print("gravado %s (%d itens, %.1f KB)" % (
        path, len(obj) if isinstance(obj, list) else -1, os.path.getsize(full) / 1024))
