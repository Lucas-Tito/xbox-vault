#!/usr/bin/env python3
"""Gera data/xbox.json: lista completa de jogos do Xbox ORIGINAL (2001-2009)
com a classificacao de retrocompatibilidade com Xbox 360.

Fontes (Wikipedia EN):
  * "List of Xbox games"                            -> tabela id="softwarelist"  (lista mestra)
  * "List of Xbox games compatible with Xbox 360"   -> tabela id="x360bclist"    (retrocompat.)

Idempotente: pode ser re-executado; usa o cache em disco de wikilib.

Uso:  python3 tools/build_xbox.py
"""
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wikilib as w  # noqa: E402  (NAO modificar wikilib.py)

MASTER_PAGE = "List of Xbox games"
BC_PAGE = "List of Xbox games compatible with Xbox 360"
OUT = "data/xbox.json"


# --------------------------------------------------------------------------
# Parsing de tabelas (versao propria e mais robusta que iter_table_rows).
#
# Motivo: o wikitext da lista mestra contem "{{dts|2002|Nov|}}" (dia vazio).
# A sequencia "|}" dentro desse template faz o scanner de wikilib achar que a
# tabela terminou, truncando ~145 dos 989 jogos. Aqui o scanner ignora "{|",
# "|}" e "\n|-" que estejam dentro de templates {{...}} ou links [[...]].
# --------------------------------------------------------------------------

def table_body(wikitext, table_id):
    """Devolve o wikitext bruto da tabela com id=table_id (do '{|' ao '|}')."""
    wt = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    i = wt.find('id="%s"' % table_id)
    if i < 0:
        raise KeyError("tabela id=%r nao encontrada" % table_id)
    start = wt.rfind("{|", 0, i + 1)
    j, d_tbl, d_tpl, d_lnk = start, 0, 0, 0
    while j < len(wt):
        if wt.startswith("{{", j):
            d_tpl += 1; j += 2; continue
        if wt.startswith("}}", j):
            d_tpl = max(0, d_tpl - 1); j += 2; continue
        if d_tpl == 0:
            if wt.startswith("[[", j):
                d_lnk += 1; j += 2; continue
            if wt.startswith("]]", j):
                d_lnk = max(0, d_lnk - 1); j += 2; continue
            if d_lnk == 0:
                if wt.startswith("{|", j):
                    d_tbl += 1; j += 2; continue
                if wt.startswith("|}", j):
                    d_tbl -= 1; j += 2
                    if d_tbl == 0:
                        break
                    continue
        j += 1
    return wt[start:j]


def split_rows(body):
    """Quebra o corpo da tabela em linhas ('\\n|-' fora de template/link)."""
    out, cur, d_tpl, d_lnk = [], "", 0, 0
    k = 0
    while k < len(body):
        if body.startswith("{{", k):
            d_tpl += 1; cur += "{{"; k += 2; continue
        if body.startswith("}}", k):
            d_tpl = max(0, d_tpl - 1); cur += "}}"; k += 2; continue
        if d_tpl == 0:
            if body.startswith("[[", k):
                d_lnk += 1; cur += "[["; k += 2; continue
            if body.startswith("]]", k):
                d_lnk = max(0, d_lnk - 1); cur += "]]"; k += 2; continue
            if d_lnk == 0 and body.startswith("\n|-", k):
                out.append(cur); cur = ""; k += 3
                while k < len(body) and body[k] != "\n":  # descarta atributos do |-
                    k += 1
                continue
        cur += body[k]; k += 1
    out.append(cur)
    return out[1:]          # out[0] = cabecalho/atributos antes da 1a linha


_SCOPE_ROW = re.compile(r'\s*scope\s*=\s*"?row"?\s*\|?\s*')
_HEADERISH = re.compile(r'^(rowspan|colspan|scope\s*=\s*"?col|style\s*=|class\s*=)', re.I)


def split_cells(row):
    """Quebra uma linha de tabela em celulas cruas ('\\n|', '\\n!' ou '||')."""
    cells, cur, d_tpl, d_lnk = [], "", 0, 0
    k = 0
    while k < len(row):
        if row.startswith("{{", k):
            d_tpl += 1; cur += "{{"; k += 2; continue
        if row.startswith("}}", k):
            d_tpl = max(0, d_tpl - 1); cur += "}}"; k += 2; continue
        if d_tpl == 0:
            if row.startswith("[[", k):
                d_lnk += 1; cur += "[["; k += 2; continue
            if row.startswith("]]", k):
                d_lnk = max(0, d_lnk - 1); cur += "]]"; k += 2; continue
            if d_lnk == 0:
                if row.startswith("||", k):
                    cells.append(cur); cur = ""; k += 2; continue
                if row.startswith("\n|", k) or row.startswith("\n!", k):
                    cells.append(cur); cur = ""; k += 2
                    m = _SCOPE_ROW.match(row, k)
                    if m:
                        k = m.end()
                    continue
        cur += row[k]; k += 1
    cells.append(cur)
    cells = [c.strip().lstrip("|").strip() for c in cells]
    while cells and cells[0] == "":
        cells.pop(0)
    return cells


def rows_of(wikitext, table_id):
    """Itera as celulas das linhas de DADOS da tabela (pula cabecalhos)."""
    for row in split_rows(table_body(wikitext, table_id)):
        cells = split_cells(row)
        if not cells or _HEADERISH.match(cells[0]):
            continue
        yield cells


# --------------------------------------------------------------------------
# Limpeza de celulas
# --------------------------------------------------------------------------

def _tpl_params(inner):
    """Quebra o miolo de um template nos '|' de nivel superior."""
    parts, cur, d_tpl, d_lnk = [], "", 0, 0
    k = 0
    while k < len(inner):
        if inner.startswith("{{", k):
            d_tpl += 1; cur += "{{"; k += 2; continue
        if inner.startswith("}}", k):
            d_tpl -= 1; cur += "}}"; k += 2; continue
        if inner.startswith("[[", k):
            d_lnk += 1; cur += "[["; k += 2; continue
        if inner.startswith("]]", k):
            d_lnk -= 1; cur += "]]"; k += 2; continue
        if inner[k] == "|" and d_tpl == 0 and d_lnk == 0:
            parts.append(cur); cur = ""; k += 1; continue
        cur += inner[k]; k += 1
    parts.append(cur)
    return parts


def _expand_named(s, names, pick):
    """Substitui {{name|...}} pelo parametro escolhido por `pick(params)`."""
    pat = re.compile(r"\{\{\s*(%s)\s*\|" % "|".join(names), re.I)
    while True:
        m = pat.search(s)
        if not m:
            return s
        k, depth = m.end(), 1
        while k < len(s) and depth:
            if s.startswith("{{", k):
                depth += 1; k += 2; continue
            if s.startswith("}}", k):
                depth -= 1; k += 2; continue
            k += 1
        inner = s[m.end():k - 2]
        s = s[:m.start()] + (pick(_tpl_params(inner)) or "") + s[k:]


def _drop_noise(s):
    s = re.sub(r"<ref[^>]*?/>", "", s)
    s = re.sub(r"<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<span[^>]*></span>", "", s, flags=re.I)
    s = _expand_named(s, ["efn", "efn-ua", "refn", "notetag"], lambda p: "")
    return s


def clean_title(cell):
    """Titulo legivel a partir da celula de titulo."""
    s = _drop_noise(cell or "")
    s = _expand_named(s, ["sort", "sortname"], lambda p: p[-1] if p else "")
    s = _expand_named(s, ["abbr"], lambda p: p[0] if p else "")
    s = _expand_named(s, ["small"], lambda p: p[0] if p else "")
    s = re.split(r"<br\s*/?>", s, flags=re.I)[0]     # BC lista titulos alternativos
    return w.strip_wiki(s)


_CORP_TAIL = re.compile(r"^(inc|inc\.|ltd|ltd\.|llc|l\.l\.c\.|co|co\.|gmbh|s\.a\.|sa|kk|k\.k\.|"
                        r"corp|corp\.|plc|ag|ab|as|bv|b\.v\.|pty|srl|limited|s\.r\.l\.)\b", re.I)


def parse_people(cell):
    """Lista de desenvolvedores/publishers de uma celula."""
    s = _drop_noise(cell or "")
    s = re.sub(r"<sup>.*?</sup>", "", s, flags=re.S | re.I)
    s = re.sub(r"<small>|</small>", "", s, flags=re.I)
    s = _expand_named(s, ["hlist", "plainlist", "ubl", "unbulleted list", "flatlist",
                          "collapsible list", "startflatlist"],
                      lambda p: "\x01".join(x for x in p if "=" not in x.split("|")[0][:20]))
    s = _expand_named(s, ["nowrap", "sort", "sortname"], lambda p: p[-1] if p else "")
    s = re.sub(r"<br\s*/?>", "\x01", s, flags=re.I)
    s = s.replace("<li>", "\x01").replace("</li>", "")

    out = []
    for chunk in s.split("\x01"):
        txt = w.strip_wiki(chunk)
        if not txt:
            continue
        for piece in re.split(r",\s*(?![a-z])|;\s*", txt):
            piece = piece.strip(" ,;/")
            if not piece:
                continue
            if out and _CORP_TAIL.match(piece):      # "Sega of America" + "Inc."
                out[-1] = out[-1] + ", " + piece
                continue
            out.append(piece)
    seen, uniq = set(), []
    for x in out:
        if x.lower() not in seen:
            seen.add(x.lower()); uniq.append(x)
    return uniq


_MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def parse_release(cell):
    """Data ISO mais ANTIGA de uma celula de lancamento regional (ou None)."""
    cell = cell or ""
    if not re.search(r"\{\{\s*dts", cell, re.I):
        return None
    found = []
    for m in re.finditer(r"\{\{\s*dts\s*\|([^}]*)\}\}", cell, re.I):
        params = [p.strip() for p in m.group(1).split("|") if "=" not in p]
        params = [p for p in params if p]
        if not params:
            continue
        # forma "{{dts|YYYY|Mon|DD}}"
        if re.fullmatch(r"\d{4}", params[0]):
            year = int(params[0])
            mo = _MONTHS.get(params[1][:3].lower()) if len(params) > 1 else None
            day = params[2] if len(params) > 2 and re.fullmatch(r"\d{1,2}", params[2]) else None
            if mo and day:
                found.append("%04d-%02d-%02d" % (year, mo, int(day)))
            elif mo:
                found.append("%04d-%02d" % (year, mo))
            else:
                found.append("%04d" % year)
            continue
        # forma "{{dts|November 22, 2005}}"
        m2 = re.search(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", " ".join(params))
        if m2 and m2.group(1)[:3].lower() in _MONTHS:
            found.append("%s-%02d-%02d" % (m2.group(3), _MONTHS[m2.group(1)[:3].lower()],
                                           int(m2.group(2))))
            continue
        m3 = re.search(r"\b(19\d\d|20\d\d)\b", " ".join(params))
        if m3:
            found.append(m3.group(1))
    return min(found) if found else None


def slugify(text):
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("&", " and ").replace("+", " plus ")
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s or "untitled"


_ARTICLES = re.compile(r"^(the|a|an)\s+", re.I)


def norm_key(text):
    """Chave normalizada p/ casar titulos com grafias divergentes."""
    s = unicodedata.normalize("NFKD", text or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"\s*\([^)]*\)\s*$", " ", s)          # remove desambiguador final
    s = s.replace("&", " and ")
    s = re.sub(r"[‐-―−]", "-", s)     # travessoes -> hifen
    s = re.sub(r"[‘’ʼ]", "'", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = _ARTICLES.sub("", s).strip()
    return re.sub(r"\s+", " ", s)


def norm_wiki(title):
    if not title:
        return None
    t = title.replace("_", " ").split("#")[0].strip()
    return re.sub(r"\s+", " ", t)


# --------------------------------------------------------------------------
# Flags de retrocompatibilidade (spans coloridos da pagina de BC)
# --------------------------------------------------------------------------

def _has_badge(text, label, color):
    """Detecta o span de legenda (pelo rotulo E/OU pela cor de fundo)."""
    if re.search(r"<span[^>]*>\s*(?:&nbsp;|\s)*%s(?:&nbsp;|\s)*</span>" % re.escape(label),
                 text, re.I):
        return True
    return bool(re.search(r"<span[^>]*%s[^>]*>\s*(?:&nbsp;|\s)*%s\b" %
                          (re.escape(color), re.escape(label)), text, re.I))


def bc_flags(row_cells):
    """(xboxOriginals, xboxOne, region, regions) a partir das celulas Add-Ons/Region(s).

    `regions` guarda os selos crus (NA/PAL/JP). Seis jogos trazem NA *e* PAL ao
    mesmo tempo (lancados nas duas regioes, mas nao no Japao); como o campo
    `region` so aceita um valor, esses viram "all" (nao ha trava de regiao unica)
    e a combinacao exata fica preservada em `regions`.
    """
    tail = " ".join(row_cells[2:])                  # issues + add-ons + region + ref
    xo = _has_badge(tail, "XO", "#fc8")
    xbo = _has_badge(tail, "XBO", "#3f0")
    cells = " ".join(row_cells[3:5]) if len(row_cells) > 3 else tail
    regions = [name for name, label, color in
               (("NA", "NA", "#fbd"), ("PAL", "PAL", "#bdf"), ("JP", "J", "#f00"))
               if _has_badge(cells, label, color)]
    region = regions[0] if len(regions) == 1 else "all"
    return xo, xbo, region, (regions or None)


# --------------------------------------------------------------------------
# Coleta
# --------------------------------------------------------------------------

def load_master():
    wt = w.fetch_wikitext(MASTER_PAGE)
    games = []
    for cells in rows_of(wt, "softwarelist"):
        cells = (cells + [""] * 6)[:6]
        title = clean_title(cells[0])
        if not title:
            continue
        releases = {
            "PAL": parse_release(cells[3]),
            "JP": parse_release(cells[4]),
            "NA": parse_release(cells[5]),
        }
        years = [int(v[:4]) for v in releases.values() if v]
        games.append({
            "title": title,
            "wiki": norm_wiki(w.link_target(cells[0])),
            "year": min(years) if years else None,
            "releases": {"NA": releases["NA"], "PAL": releases["PAL"], "JP": releases["JP"]},
            "developers": parse_people(cells[1]),
            "publishers": parse_people(cells[2]),
        })
    return games


def load_bc():
    wt = w.fetch_wikitext(BC_PAGE)
    out = []
    for cells in rows_of(wt, "x360bclist"):
        cells = (cells + [""] * 6)[:6]
        title = clean_title(cells[0])
        if not title:
            continue
        xo, xbo, region, regions = bc_flags(cells)
        issues = w.strip_wiki(_drop_noise(cells[2])) or None
        out.append({
            "title": title,
            "wiki": norm_wiki(w.link_target(cells[0])),
            "publishers": parse_people(cells[1]),
            "bc": {"compatible": True, "region": region, "regions": regions,
                   "xboxOriginals": xo, "xboxOne": xbo, "issues": issues},
        })
    return out


def resolve_redirects(titles):
    """{titulo: titulo_canonico} via API (resolve redirects da Wikipedia)."""
    mapping = {}
    titles = [t for t in titles if t]
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        try:
            d = w.api({"action": "query", "redirects": "1", "titles": "|".join(chunk)})
        except Exception:
            continue
        q = d.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        for t in chunk:
            step = norm.get(t, t)
            seen = 0
            while step in redir and seen < 5:
                step = redir[step]; seen += 1
            mapping[t] = step
    return mapping


def main():
    master = load_master()
    bc = load_bc()
    print("lista mestra: %d jogos | lista BC: %d titulos" % (len(master), len(bc)))

    # Indices da lista mestra. Um mesmo artigo serve varias linhas da lista mestra
    # (ex.: "Namco Museum" e "Namco Museum 50th Anniversary" apontam para
    # [[Namco Museum]]), entao os indices guardam LISTAS de candidatos.
    by_wiki, by_norm = defaultdict(list), defaultdict(list)
    for g in master:
        if g["wiki"]:
            by_wiki[g["wiki"].lower()].append(g)
            by_norm[norm_key(re.sub(r"\s*\([^)]*\)$", "", g["wiki"]))].append(g)
        by_norm[norm_key(g["title"])].append(g)

    # Um registro da lista mestra so pode ser reivindicado por UMA linha da lista
    # de BC; senao entradas como "Halo 2 Multiplayer Map Pack" (disco avulso cujo
    # link redireciona para o artigo de Halo 2) sobrescreveriam o jogo principal.
    claimed = {}
    matched_by, unmatched = Counter(), []

    def claim(cands, b, how):
        """Reivindica o candidato livre com titulo mais parecido com o da linha BC."""
        free = [g for g in (cands or []) if id(g) not in claimed]
        if not free:
            return False
        key = norm_key(b["title"])
        hit = max(free, key=lambda g: SequenceMatcher(None, key, norm_key(g["title"])).ratio())
        claimed[id(hit)] = b
        b["_hit"] = hit
        matched_by[how] += 1
        return True

    for b in bc:
        b["_hit"] = None
        wiki_bare = norm_key(re.sub(r"\s*\([^)]*\)$", "", b["wiki"])) if b["wiki"] else None
        (claim(by_wiki.get(b["wiki"].lower()) if b["wiki"] else None, b, "wiki")
         or claim(by_norm.get(norm_key(b["title"])), b, "titulo normalizado")
         or claim(by_norm.get(wiki_bare) if wiki_bare else None, b, "wiki normalizado"))
        if b["_hit"] is None:
            unmatched.append(b)

    # ultima tentativa: resolver redirects na API e recasar pelo artigo canonico
    if unmatched:
        want = [b["wiki"] for b in unmatched if b["wiki"]]
        want += [g["wiki"] for g in master if g["wiki"]]
        canon = resolve_redirects(sorted(set(want)))
        master_canon = defaultdict(list)
        for g in master:
            if g["wiki"]:
                master_canon[canon.get(g["wiki"], g["wiki"]).lower()].append(g)
        still = []
        for b in unmatched:
            tgt = canon.get(b["wiki"], b["wiki"])
            if not claim(master_canon.get(tgt.lower()) if tgt else None, b, "redirect"):
                still.append(b)
        unmatched = still

    for b in bc:
        if b["_hit"] is not None:
            b["_hit"]["_bc"] = b["bc"]

    NO_BC = {"compatible": False, "region": None, "regions": None,
             "xboxOriginals": False, "xboxOne": False, "issues": None}

    records, used = [], Counter()

    def emit(title, wiki, year, releases, devs, pubs, bc360, source):
        base = "xbox-" + slugify(title)
        used[base] += 1
        rid = base if used[base] == 1 else "%s-%d" % (base, used[base])
        records.append({
            "id": rid, "platform": "xbox", "title": title, "wiki": wiki,
            "year": year, "releases": releases, "developers": devs,
            "publishers": pubs, "bc360": bc360, "source": source,
        })

    for g in master:
        emit(g["title"], g["wiki"], g["year"], g["releases"], g["developers"],
             g["publishers"], dict(g.get("_bc") or NO_BC), "master")
    for b in unmatched:
        emit(b["title"], b["wiki"], None,
             {"NA": None, "PAL": None, "JP": None}, [], b["publishers"],
             dict(b["bc"]), "bc-only")

    # ---------------- verificacao ----------------
    total = len(records)
    compat = sum(1 for r in records if r["bc360"]["compatible"])
    ids = [r["id"] for r in records]
    problems = []
    if not (900 <= total <= 1100):
        problems.append("total fora de 900-1100: %d" % total)
    if len(set(ids)) != total:
        dup = [k for k, v in Counter(ids).items() if v > 1]
        problems.append("ids duplicados: %s" % dup[:10])
    if any(not r["title"] for r in records):
        problems.append("titulo vazio encontrado")
    if not (400 <= compat <= 500):
        problems.append("compativeis fora de 400-500: %d" % compat)

    # gravacao movida para DEPOIS da validacao (ver bloco de problems)

    print("\n== casamento ==")
    for k, v in matched_by.most_common():
        print("  por %-18s %d" % (k, v))
    print("  NAO casados        %d" % len(unmatched))
    for b in unmatched:
        print("     - %s (wiki=%s)" % (b["title"], b["wiki"]))

    print("\n== totais ==")
    print("  jogos            %d" % total)
    print("  retrocompativeis %d (%.1f%%)" % (compat, 100.0 * compat / max(total, 1)))
    print("  Xbox Originals   %d" % sum(1 for r in records if r["bc360"]["xboxOriginals"]))
    print("  Xbox One fwd     %d" % sum(1 for r in records if r["bc360"]["xboxOne"]))
    print("  com notas/issues %d" % sum(1 for r in records if r["bc360"]["issues"]))
    print("  regiao BC: %s" % dict(Counter(r["bc360"]["region"] for r in records
                                           if r["bc360"]["compatible"])))
    print("  selos crus: %s" % dict(Counter("+".join(r["bc360"]["regions"] or ["-"])
                                            for r in records if r["bc360"]["compatible"])))
    print("  sem wiki         %d" % sum(1 for r in records if not r["wiki"]))

    print("\n== por ano ==")
    yc = Counter(r["year"] for r in records)
    for y in sorted(yc, key=lambda x: (x is None, x)):
        print("  %-6s %4d" % (y if y is not None else "null", yc[y]))

    print("\n== spot-check ==")
    for name in ["Halo: Combat Evolved", "Halo 2", "Fable", "Ninja Gaiden Black",
                 "Steel Battalion"]:
        r = next((x for x in records if x["title"] == name), None)
        if not r:
            print("  %-22s NAO ENCONTRADO" % name); problems.append("faltando %s" % name); continue
        print("  %-22s ano=%s bc=%s reg=%s dev=%s pub=%s wiki=%r" % (
            name, r["year"], r["bc360"]["compatible"], r["bc360"]["region"],
            "/".join(r["developers"]) or "-", "/".join(r["publishers"]) or "-", r["wiki"]))

    # So grava se a validacao passou: gravar antes sobrescrevia o catalogo bom
    if problems:
        print("\nABORTADO: %d problema(s), %s NAO foi regravado." % (len(problems), OUT))
        return 1
    w.save(OUT, records)
    if problems:
        print("\n!! VERIFICACAO FALHOU:")
        for p in problems:
            print("   - %s" % p)
        return 1
    print("\nOK: todas as verificacoes passaram.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
