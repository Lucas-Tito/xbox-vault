"""Le a nota do Metacritic na pagina de resenhas DA PLATAFORMA.

A pagina principal do jogo (/game/<slug>/) tem JSON-LD limpo, mas a nota dela e
a da plataforma principal e NAO muda com ?platform= -- usar aquilo daria a nota
de PS3 ou PC em varios jogos. Ja /game/<slug>/critic-reviews/?platform=xbox-360
traz o resumo daquela plataforma especifica, que e o que queremos.
"""
import json, re, time, urllib.error, urllib.parse, urllib.request

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/131.0 Safari/537.36")
PLAT_URL = {"x360": "xbox-360", "xbox": "xbox",
            "GBA": "game-boy-advance", "PS1": "playstation", "SNES": "super-nintendo"}
BASE = "https://www.metacritic.com/game/"

# A nota fica no HTML RENDERIZADO, nao nos dados do Next.js: ali "score":1877 e
# um indice numa tabela de valores, nao a nota. Este atributo e explicito e estavel.
# Precisa excluir c-siteReviewScore_xsmall: esse e o badge das resenhas
# INDIVIDUAIS, que usa o mesmo texto "Metascore N out of 100". Sem isso, uma
# pagina sem nota agregada devolveria a nota de uma resenha qualquer.
# Verifica _xsmall no ATRIBUTO class inteiro: o lookahead anterior dependia da
# ordem das classes e falhava com class="..._xsmall c-siteReviewScore".
_score = re.compile(r'class="([^"]*c-siteReviewScore[^"]*)"[^>]{0,400}?'
                    r'title="Metascore (\d{1,3}) out of 100"')
# ANCORADO no mesmo objeto: com .*? e re.S o casamento atravessa qualquer
# distancia e pega o nome do RESENHISTA ("Edge Magazine") e a data da RESENHA.
_nome = re.compile(r'"@type"\s*:\s*"VideoGame"[^{}]{0,400}?"name"\s*:\s*"([^"]{1,120})"')
_data = re.compile(r'"@type"\s*:\s*"VideoGame"[^{}]{0,400}?"datePublished"\s*:\s*"(\d{4})')


def _do_json_ld(h, chave):
    """Le o campo do objeto VideoGame do JSON-LD, que e inequivoco."""
    for m in _ld.finditer(h) if "_ld" in globals() else []:
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if d.get("@type") == "VideoGame" and d.get(chave):
            return str(d[chave])
    return None
def baixar(url, tentativas=3, espera=1.5):
    for n in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"})
            with urllib.request.urlopen(req, timeout=50) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                return None
            if n == tentativas - 1:
                return None
            time.sleep(espera * (n + 2))
        except Exception:
            if n == tentativas - 1:
                return None
            time.sleep(espera * (n + 2))
    return None


def slug_do_titulo(t):
    t = (t or "").lower()
    t = t.replace("&", " and ").replace("'", "").replace("’", "")
    t = re.sub(r"[^a-z0-9]+", "-", t)
    return re.sub(r"-+", "-", t).strip("-")


def _nome_norm(s):
    s = re.sub(r"[^a-z0-9]+", " ", (s or "").lower())
    return re.sub(r"\s+", " ", s).strip()


def nota(slug, plataforma, titulo=None, ano=None):
    """(nota, nome_na_pagina) ou (None, motivo).

    Confere nome E ano: so o nome nao basta porque slugs colidem -- ha varios
    jogos chamados "Ninja Gaiden", e pegar o errado traz a nota de outro jogo.
    """
    p = PLAT_URL.get(plataforma)
    if not p or not slug:
        return None, "sem-slug"
    url = "%s%s/critic-reviews/?platform=%s" % (BASE, urllib.parse.quote(slug), p)
    h = baixar(url)
    if not h:
        return None, "404"
    nome = _do_json_ld(h, "name")
    if not nome:
        mn = _nome.search(h)
        nome = mn.group(1) if mn else None
    if titulo and nome:
        a, b = _nome_norm(titulo), _nome_norm(nome)
        # confere que a pagina e do jogo certo: slug adivinhado pode cair em outro
        if not (a == b or a in b or b in a):
            return None, "nome-diferente:" + (nome or "")[:40]
    if ano:
        dp = (_do_json_ld(h, "datePublished") or "")[:4]
        if not dp.isdigit():
            md = _data.search(h)
            dp = md.group(1) if md else ""
        if dp.isdigit() and abs(int(dp) - int(ano)) > 1:
            return None, "ano-diferente:" + dp
    achados = [int(n) for cls, n in _score.findall(h)
               if "_xsmall" not in cls and 0 <= int(n) <= 100]
    if achados:
        return achados[0], nome        # o primeiro e o da plataforma pedida
    return None, "sem-nota-nessa-plataforma"


# --- caminho alternativo, para jogos sem nota POR PLATAFORMA -------------------
# O Metacritic so calcula Metascore de uma plataforma quando ha resenhas
# suficientes dela. Muito indie de Xbox 360 nao alcanca isso, mas tem nota geral.
# Usar essa nota geral e correto SO quando o jogo saiu apenas na nossa
# plataforma -- ai nao ha o que confundir. Em multiplataforma, a nota geral e a
# da plataforma principal e atribui-la ao 360 seria errado.
PLAT_NOME = {"x360": "Xbox 360", "xbox": "Xbox", "GBA": "Game Boy Advance",
             "PS1": "PlayStation", "SNES": "Super Nintendo"}
_ld = re.compile(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', re.S)


def nota_exclusiva(slug, plataforma, titulo=None, ano=None):
    """(nota, plataformas) quando o jogo so existe na NOSSA plataforma."""
    if not slug:
        return None, "sem-slug"
    h = baixar("%s%s/" % (BASE, urllib.parse.quote(slug)))
    if not h:
        return None, "404"
    dados = None
    for m in _ld.finditer(h):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if d.get("@type") == "VideoGame":
            dados = d
            break
    if not dados:
        return None, "sem-json-ld"
    nome = dados.get("name")
    if titulo and nome:
        a, b = _nome_norm(titulo), _nome_norm(nome)
        if not (a == b or a in b or b in a):
            return None, "nome-diferente:" + nome[:36]
    if ano:
        dp = str(dados.get("datePublished") or "")[:4]
        if dp.isdigit() and abs(int(dp) - int(ano)) > 1:
            return None, "ano-diferente:" + dp
    plats = dados.get("gamePlatform") or []
    if isinstance(plats, str):
        plats = [plats]
    alvo = PLAT_NOME.get(plataforma)
    if len(plats) != 1 or plats[0] != alvo:
        return None, "multiplataforma:" + ",".join(plats)[:50]
    ar = dados.get("aggregateRating") or {}
    v = ar.get("ratingValue")
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None, "sem-nota"
    return (v if 0 <= v <= 100 else None), ",".join(plats)


def nota_geral(slug, titulo=None, ano=None):
    """(nota, plataformas) da pagina principal, SEM exigir exclusividade.

    A nota e a da plataforma principal do jogo, que pode nao ser a nossa. So use
    onde isso estiver assumido e sinalizado ao usuario -- e o caso dos XBLIG, que
    quase nunca tem resenhas suficientes para um Metascore proprio de Xbox 360.
    """
    if not slug:
        return None, "sem-slug"
    h = baixar("%s%s/" % (BASE, urllib.parse.quote(slug)))
    if not h:
        return None, "404"
    dados = None
    for m in _ld.finditer(h):
        try:
            d = json.loads(m.group(1))
        except Exception:
            continue
        if d.get("@type") == "VideoGame":
            dados = d
            break
    if not dados:
        return None, "sem-json-ld"
    nome = dados.get("name")
    if titulo and nome:
        a, b = _nome_norm(titulo), _nome_norm(nome)
        if not (a == b or a in b or b in a):
            return None, "nome-diferente:" + nome[:36]
    if ano:
        dp = str(dados.get("datePublished") or "")[:4]
        if dp.isdigit() and abs(int(dp) - int(ano)) > 2:
            return None, "ano-diferente:" + dp
    ar = dados.get("aggregateRating") or {}
    try:
        v = int(ar.get("ratingValue"))
    except (TypeError, ValueError):
        return None, "sem-nota"
    plats = dados.get("gamePlatform") or []
    if isinstance(plats, str):
        plats = [plats]
    return (v if 0 <= v <= 100 else None), ", ".join(plats)[:70]
