#!/usr/bin/env python3
"""Gera data/x360.json com a lista completa de jogos de Xbox 360 (Wikipedia EN).

Fontes:
  - List of Xbox 360 games (A-L)   (en dash)
  - List of Xbox 360 games (M-Z)   (en dash)

Colunas da tabela id=softwarelist:
  Title | Genre(s) | Developer(s) | Publisher(s) | NA | EU | JP | AU | Addons | Xbox One | Ref.

Idempotente: usa o cache em disco de wikilib (cache/) e regrava o JSON do zero.
Uso:  python3 tools/build_x360.py
"""
import os
import re
import sys
import unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wikilib as w  # noqa: E402

PAGES = [
    "List of Xbox 360 games (A–L)",
    "List of Xbox 360 games (M–Z)",
]
OUT = "data/x360.json"
SEP = "‖"  # sentinela interna para separar itens de lista


# ---------------- helpers locais (nao mexer em wikilib.py) ----------------

def drop_noise(s):
    """Remove refs, comentarios, <sup> (anotacoes regionais) e sort-keys ocultas."""
    if not s:
        return ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*?/>", "", s)
    s = re.sub(r"<ref.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<sup.*?</sup>", "", s, flags=re.S)
    # spans de chave de ordenacao: <span style="display:none">King of Fighters 98, The</span>
    s = re.sub(r'<span[^>]*display:\s*none[^>]*>.*?</span>', "", s, flags=re.S | re.I)
    return s


def strip_cell_attrs(s):
    """Remove prefixo de atributos de celula: data-sort-value="x" | conteudo."""
    pat = (r'^\s*(?:data-sort-value|style|class|align|valign|scope|colspan|rowspan|'
           r'id|width|bgcolor|title)\s*=\s*(?:"[^"]*"|\'[^\']*\'|[^\s|]+)\s*')
    prev = None
    while prev != s:
        prev = s
        m = re.match(pat, s)
        if m:
            s = s[m.end():]
            if s.startswith("|") and not s.startswith("||"):
                s = s[1:]
            s = s.lstrip()
    return s


def split_top(text, seps):
    """Divide em `seps` (strings de 1 char) ignorando o que esta dentro de
    [[...]], {{...}}, <...> e parenteses."""
    out, cur = [], ""
    dl = dt = dp = 0
    i = 0
    while i < len(text):
        if text.startswith("[[", i):
            dl += 1; cur += "[["; i += 2; continue
        if text.startswith("]]", i):
            dl = max(0, dl - 1); cur += "]]"; i += 2; continue
        if text.startswith("{{", i):
            dt += 1; cur += "{{"; i += 2; continue
        if text.startswith("}}", i):
            dt = max(0, dt - 1); cur += "}}"; i += 2; continue
        ch = text[i]
        if ch == "(":
            dp += 1
        elif ch == ")":
            dp = max(0, dp - 1)
        if ch in seps and dl == 0 and dt == 0 and dp == 0:
            out.append(cur); cur = ""; i += 1; continue
        cur += ch; i += 1
    out.append(cur)
    return out


LIST_TMPL = re.compile(r"\{\{\s*(?:hlist|plainlist|ubl|unbulleted list|flatlist|"
                       r"comma separated entries)\s*\|", re.I)


def expand_list_templates(s):
    """{{hlist|a|b}} -> 'a SEP b', respeitando pipes internos de [[a|b]]."""
    while True:
        m = LIST_TMPL.search(s)
        if not m:
            return s
        # acha o fecho do template
        depth, j = 1, m.end()
        while j < len(s) and depth:
            if s.startswith("{{", j):
                depth += 1; j += 2; continue
            if s.startswith("}}", j):
                depth -= 1; j += 2; continue
            j += 1
        body = s[m.end():j - 2]
        items = [p.strip() for p in split_top(body, "|")]
        items = [p for p in items if p and not re.match(r"^\w+\s*=", p)]
        s = s[:m.start()] + SEP.join(items) + s[j:]


def clean_text(s):
    """Texto legivel de uma celula (sem atributos/refs/sup/markup)."""
    s = drop_noise(strip_cell_attrs(s or ""))
    s = re.sub(r"/\s*<br\s*/?>\s*", "/", s, flags=re.I)  # "A/<br />B" -> "A/B"
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    return w.strip_wiki(s)


def parse_list(cell):
    """Celula de developers/publishers -> lista de nomes limpos e unicos."""
    s = drop_noise(strip_cell_attrs(cell or ""))
    s = expand_list_templates(s)
    s = re.sub(r"<br\s*/?>", SEP, s, flags=re.I)
    parts = split_top(s, SEP + ",/;")
    out, seen = [], set()
    for p in parts:
        name = w.strip_wiki(p)
        name = re.sub(r"^(?:and|&)\s+", "", name, flags=re.I).strip(" .,;:-")
        if not name or name.lower() in ("n/a", "unknown", "tba", "unreleased"):
            continue
        k = name.lower()
        if k not in seen:
            seen.add(k)
            out.append(name)
    return out


def parse_genre(cell):
    s = drop_noise(strip_cell_attrs(cell or ""))
    s = expand_list_templates(s).replace(SEP, ", ")
    s = re.sub(r"<br\s*/?>", ", ", s, flags=re.I)
    g = w.strip_wiki(s)
    g = re.sub(r"\s*,\s*", ", ", g).strip(" ,;")
    return g or None


def parse_release(cell):
    """Celula de data -> (ano|None, iso|None). Usa w.parse_dts com correcoes."""
    s = drop_noise(cell or "")
    if not s.strip() or re.search(r"\{\{\s*unreleased", s, re.I):
        # ainda assim pode haver um dts apos o Unreleased; checa
        if not re.search(r"\{\{\s*dts", s, re.I):
            return None, None
    # dia com zero a esquerda extra: {{dts|2015|Oct|013}} -> 13
    s = re.sub(r"(\{\{dts\|\d{4}\|\w+\|)0(\d\d)", r"\1\2", s, flags=re.I)
    year, iso = w.parse_dts(s)
    if year is None:
        return None, None
    if iso is None:
        iso = str(year)
    return year, iso


SPAN_RE = re.compile(r"<span([^>]*)>(.*?)</span>", re.S)


def parse_flags(cells):
    """Le todas as celulas de 'Addons'/'Xbox One'/'Ref.' e extrai os marcadores."""
    flags = {"xbla": False, "xblig": False, "dl": False,
             "kinect": None, "stereo3d": False, "xboxOne": False}
    for cell in cells:
        cell = drop_noise(cell)
        for attrs, txt in SPAN_RE.findall(cell):
            tok = re.sub(r"<[^>]+>", "", txt).replace("&nbsp;", " ").strip().upper()
            if tok == "XBLA":
                flags["xbla"] = True
            elif tok == "XBLIG":
                flags["xblig"] = True
            elif tok == "DL":
                flags["dl"] = True
            elif tok == "3D":
                flags["stereo3d"] = True
            elif tok == "K":
                req = "border:1px solid #da2" in attrs.replace(" ", " ")
                if req or flags["kinect"] is None:
                    flags["kinect"] = "required" if req else "optional"
            elif tok in ("XBO", "XE"):
                flags["xboxOne"] = True
    return flags


def slugify(title):
    s = unicodedata.normalize("NFKD", title)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("&", " and ").replace("+", " plus ")
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "game"


# ---------------- extracao ----------------

def parse_page(page):
    wt = w.fetch_wikitext(page)
    games = []
    for cells in w.iter_table_rows(wt, table_id="softwarelist"):
        if len(cells) < 8:
            continue  # cabecalho da 2a linha, lixo de fechamento, tabelas sem datas
        raw_title = drop_noise(strip_cell_attrs(cells[0]))
        title = clean_text(cells[0])
        if not title:
            continue
        if title.lower() in ("title", "genre(s)"):
            continue
        releases, years = {}, []
        for reg, idx in (("NA", 4), ("EU", 5), ("JP", 6), ("AU", 7)):
            y, iso = parse_release(cells[idx])
            releases[reg] = iso
            if y:
                years.append(y)
        games.append({
            "id": None,
            "platform": "x360",
            "title": title,
            "wiki": w.link_target(raw_title),
            "year": min(years) if years else None,
            "releases": releases,
            "genre": parse_genre(cells[1]),
            "developers": parse_list(cells[2]),
            "publishers": parse_list(cells[3]),
            "flags": parse_flags(cells[8:]),
        })
    return games


def main():
    games = []
    for p in PAGES:
        got = parse_page(p)
        print("%-34s -> %d jogos" % (p, len(got)))
        games.extend(got)

    taken = set()
    for g in games:
        base = "x360-" + slugify(g["title"])
        gid, n = base, 1
        while gid in taken:
            n += 1
            gid = "%s-%d" % (base, n)
        taken.add(gid)
        g["id"] = gid

    w.save(OUT, games)
    verify(games)
    return games


# ---------------- verificacao ----------------

def verify(games):
    print("\n=== VERIFICACAO ===")
    total = len(games)
    ok = True

    def chk(label, cond, extra=""):
        nonlocal ok
        print("%s %s %s" % ("OK  " if cond else "FALHA", label, extra))
        ok = ok and cond

    chk("total entre 2100 e 2250", 2100 <= total <= 2250, "-> %d" % total)
    empty = [g for g in games if not (g["title"] or "").strip()]
    chk("nenhum title vazio", not empty, "-> %d vazios" % len(empty))
    ids = [g["id"] for g in games]
    dup = [k for k, v in Counter(ids).items() if v > 1]
    chk("ids unicos", not dup, "-> %d duplicados %s" % (len(dup), dup[:5]))
    wiki_ok = sum(1 for g in games if g["wiki"])
    chk("wiki >= 85%", wiki_ok / total >= 0.85,
        "-> %.1f%% (%d nulos)" % (100.0 * wiki_ok / total, total - wiki_ok))
    year_ok = sum(1 for g in games if g["year"])
    chk("year >= 90%", year_ok / total >= 0.90,
        "-> %.1f%% (%d nulos)" % (100.0 * year_ok / total, total - year_ok))

    print("\n--- distribuicao por ano ---")
    years = Counter(g["year"] for g in games)
    for y in sorted(years, key=lambda x: (x is None, x)):
        print("  %s: %d" % (y if y else "null", years[y]))

    print("\n--- spot-check ---")
    for name in ("Halo 3", "Gears of War", "Minecraft: Xbox 360 Edition",
                 "Left 4 Dead", "The Elder Scrolls V: Skyrim"):
        hit = [g for g in games if g["title"] == name] or \
              [g for g in games if g["title"].lower().startswith(name.lower())]
        if not hit:
            print("  !! nao encontrado: %s" % name)
            ok = False
            continue
        g = hit[0]
        print("  %s | ano=%s | wiki=%s | dev=%s | pub=%s | genre=%s" % (
            g["title"], g["year"], g["wiki"], g["developers"], g["publishers"], g["genre"]))
        print("      releases=%s flags=%s" % (g["releases"], g["flags"]))

    print("\nRESULTADO: %s" % ("TUDO OK" if ok else "HA FALHAS"))
    return ok


if __name__ == "__main__":
    main()
