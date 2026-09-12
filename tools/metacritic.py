"""Extrai a nota do Metacritic do wikitext, escolhendo a da plataforma certa.

O campo MC do template {{Video game reviews}} e livre e costuma trazer VARIAS
notas no mesmo campo, uma por plataforma:

    Xbox: 97/100<ref name="x"/><br />PC: 83/100<ref name="y"/>
    (360) 94/100<ref>...</ref>
    94/100 <small>(PC)</small><br />96/100 <small>(X360)</small>

Pegar o primeiro numero daria a nota da plataforma errada com frequencia, entao
aqui cada trecho e casado com a plataforma que ele menciona.
"""
import re

# como cada plataforma nossa aparece escrita no campo
MARCAS = {
    "x360": [r"\bx\s*360\b", r"\bxbox\s*360\b", r"\bxb360\b", r"\b360\b", r"\bx-?box\s*360\b"],
    "xbox": [r"\bxbox\b(?!\s*(?:360|one|series))", r"\bxbx\b", r"\bx-?box\b(?!\s*(?:360|one))"],
}
# plataformas que NAO sao nossas: se o trecho so menciona uma delas, descarta
OUTRAS = [r"\bpc\b", r"\bwindows\b", r"\bps[2345]\b", r"\bplaystation\b", r"\bps3\b", r"\bps4\b",
          r"\bwii\b", r"\bds\b", r"\b3ds\b", r"\bpsp\b", r"\bvita\b", r"\bswitch\b",
          r"\bios\b", r"\bandroid\b", r"\bmac\b", r"\blinux\b", r"\bgba\b", r"\bgamecube\b",
          r"\bdreamcast\b", r"\bn64\b", r"\bxbox one\b", r"\bseries x\b", r"\bmobile\b"]


def _limpar(s):
    # refs auto-fechadas ANTES do par: senao um <ref name="x" /> engole ate o proximo </ref>
    s = re.sub(r"<ref[^>]*/\s*>", " ", s or "")
    s = re.sub(r"<ref(?![^>]*/>)[^>]*>.*?</ref>", " ", s, flags=re.S)
    s = re.sub(r"\{\{[Cc]ite[^{}]*\}\}", " ", s)
    s = re.sub(r"'{2,}", " ", s)
    s = re.sub(r"</?small>|</?sup>|</?b>|</?i>", " ", s)
    return s


def _valor_apos(wikitext, pos):
    """Le o valor de um parametro de template a partir de pos, ate o proximo
    parametro de topo ou o fim do template."""
    i, dep_t, dep_l, out = pos, 0, 0, []
    while i < len(wikitext):
        if wikitext.startswith("{{", i): dep_t += 1; out.append("{{"); i += 2; continue
        if wikitext.startswith("}}", i):
            if dep_t == 0: break
            dep_t -= 1; out.append("}}"); i += 2; continue
        if wikitext.startswith("[[", i): dep_l += 1; out.append("[["); i += 2; continue
        if wikitext.startswith("]]", i): dep_l -= 1; out.append("]]"); i += 2; continue
        if wikitext[i] == "|" and dep_t == 0 and dep_l == 0:
            break
        out.append(wikitext[i]); i += 1
    return "".join(out)


def campos_mc(wikitext):
    """[{rot, val, plat}] de todos os campos de nota do artigo.

    Tres formatos convivem na Wikipedia:
      MC = 94/100                  -> artigo de um jogo so
      MC_XBOX = 95/100             -> plataforma no NOME do campo (o mais confiavel)
      game1 = X | mc1 = (X360) 85  -> artigo de serie, uma nota por jogo
    """
    if not wikitext:
        return []
    out = []
    # plataforma no nome do campo: MC_XBOX, MC_360, MC_PC...
    for m in re.finditer(r"\|\s*MC[_-]([A-Za-z0-9]+)\s*=\s*", wikitext):
        suf = m.group(1).upper()
        plat = None
        if suf in ("360", "X360", "XBOX360", "XB360"):
            plat = "x360"
        elif suf in ("XBOX", "XB", "XBX"):
            plat = "xbox"
        out.append({"rot": None, "val": _valor_apos(wikitext, m.end()), "plat": plat,
                    "suf": suf})
    # campo simples
    for pad in (r"\|\s*MC\s*=\s*", r"\|\s*Metacritic\s*=\s*"):
        m = re.search(pad, wikitext, re.I)
        if m:
            out.append({"rot": None, "val": _valor_apos(wikitext, m.end()), "plat": None,
                        "suf": None})
            break
    # artigo de serie
    jogos = {}
    for m in re.finditer(r"\|\s*game(\d+)\s*=\s*", wikitext, re.I):
        jogos[m.group(1)] = _valor_apos(wikitext, m.end())
    for m in re.finditer(r"\|\s*mc(\d+)\s*=\s*", wikitext, re.I):
        out.append({"rot": jogos.get(m.group(1)), "val": _valor_apos(wikitext, m.end()),
                    "plat": None, "suf": None})
    return out


# A citacao ao lado da nota traz a URL do Metacritic COM a plataforma dentro
# (?platform=xbox-360, /xbox-360/...). E a propria Wikipedia dizendo de que
# plataforma e aquela nota -- sinal bem mais forte que adivinhar pelo texto.
URL_PLAT = [
    ("x360", re.compile(r"metacritic\.com[^\s\]}|]*(?:platform=xbox-360|/xbox-360/)", re.I)),
    ("xbox", re.compile(r"metacritic\.com[^\s\]}|]*(?:platform=xbox\b(?!-)|/xbox/)", re.I)),
]
OUTRA_URL = re.compile(r"metacritic\.com[^\s\]}|]*(?:platform=|/)(?:pc|playstation|ps[2345]|"
                       r"wii|switch|ios|android|gamecube|dreamcast|3ds|ds|psp|vita|"
                       r"xbox-one|xbox-series)", re.I)


def notas_por_url(val, plataforma):
    """Notas cujo ref aponta para a URL do Metacritic da NOSSA plataforma."""
    if not val:
        return []
    ms = [m for m in re.finditer(r"(\b\d{1,3})\s*/\s*100", val)
          if 0 <= int(m.group(1)) <= 100]
    achados = []
    for i, m in enumerate(ms):
        # A janela PARA onde comeca a proxima nota. Sem esse limite, um ref
        # nomeado sem URL (<ref name="MCPC"/>) faz a busca cair no ref da nota
        # seguinte e atribuir a plataforma errada.
        fim = ms[i + 1].start() if i + 1 < len(ms) else len(val)
        janela = val[m.end():min(fim, m.end() + 600)]
        for plat, pad in URL_PLAT:
            if pad.search(janela):
                achados.append((int(m.group(1)), plat))
                break
    return [n for n, p in achados if p == plataforma]


def _notas(txt):
    """[(nota, contexto)] de um campo. Aceita '94/100' e tambem '(X360) 85'."""
    txt = _limpar(txt)
    achados = []
    for t in [x for x in re.split(r"<br\s*/?>|\n", txt) if x.strip()]:
        casou = False
        for m in re.finditer(r"(\b\d{1,3})\s*/\s*100", t):
            n = int(m.group(1))
            if 0 <= n <= 100:
                achados.append((n, (t[:m.start()] + " " + t[m.end():m.end() + 40]).lower()))
                casou = True
        if casou:
            continue
        # formato do VG Series Reviews: plataforma entre parenteses e a nota crua
        for m in re.finditer(r"\(([^)]{1,14})\)\s*(\d{1,3})\b", t):
            n = int(m.group(2))
            if 0 <= n <= 100:
                achados.append((n, m.group(1).lower()))
                casou = True
        if not casou:
            m = re.match(r"\s*(\d{1,3})\s*$", t)
            if m and 0 <= int(m.group(1)) <= 100:
                achados.append((int(m.group(1)), ""))
    return achados


def _norm_titulo(s):
    # o rotulo costuma vir como link: [[Dead Rising (video game)|Dead Rising]]
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s or "")
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\((?:video game|[^)]*game[^)]*)\)", " ", s, flags=re.I)
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def extrair(wikitext, plataforma, titulo=None):
    """(nota, como_foi_escolhida) ou (None, None). plataforma: "x360" ou "xbox"."""
    campos = campos_mc(wikitext)
    if not campos:
        return None, None
    alvo = _norm_titulo(titulo)

    # 0) a URL do proprio ref diz a plataforma: sinal mais confiavel de todos
    for c in campos:
        porurl = notas_por_url(c["val"], plataforma)
        if porurl:
            return porurl[0], "url-do-ref"

    escolhido, via = None, None

    # 1) campo cuja PLATAFORMA esta no nome (MC_XBOX, MC_360) -- sem ambiguidade
    for c in campos:
        if c["plat"] == plataforma:
            escolhido, via = c["val"], "campo-da-plataforma"; break
    # 2) artigo de serie: campo do jogo certo
    if escolhido is None and alvo:
        for c in campos:
            if c["rot"] and _norm_titulo(c["rot"]) == alvo:
                escolhido, via = c["val"], "campo-do-jogo"; break
        if escolhido is None:
            for c in campos:
                r = _norm_titulo(c["rot"])
                if r and (r in alvo or alvo in r):
                    escolhido, via = c["val"], "campo-do-jogo-parcial"; break
    # 3) campo simples, sem rotulo nem sufixo
    if escolhido is None:
        for c in campos:
            if c["rot"] is None and c["suf"] is None:
                escolhido, via = c["val"], None; break
    # 4) se so existem campos de OUTRAS plataformas, nao ha nota nossa
    if escolhido is None:
        if all(c["suf"] for c in campos):
            return None, None
        if len(campos) == 1:
            escolhido = campos[0]["val"]
    if escolhido is None:
        return None, None
    achados = _notas(escolhido)
    if not achados:
        return None, None
    if via:                       # o campo ja identifica a plataforma
        return achados[0][0], via

    nossas = MARCAS[plataforma]
    # 1) trecho que menciona explicitamente a nossa plataforma
    for nota, ctx in achados:
        if any(re.search(p, ctx) for p in nossas):
            return nota, "plataforma-explicita"
    # 2) so ha uma nota e nenhum trecho aponta outra plataforma -> e dela mesmo
    if len(achados) == 1:
        nota, ctx = achados[0]
        if any(re.search(p, ctx) for p in OUTRAS):
            return None, None          # a unica nota e de outra plataforma
        return nota, "nota-unica"
    # 3) varias notas, nenhuma identificada: pega a primeira que nao seja de outra
    for nota, ctx in achados:
        if not any(re.search(p, ctx) for p in OUTRAS):
            return nota, "primeira-sem-outra-plataforma"
    return None, None
