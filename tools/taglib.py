"""Extracao de modos de jogo (single/multi/coop/versus/nº de jogadores) do wikitext.

Compartilhado pelos 3 agentes de tags para que o criterio seja IDENTICO entre plataformas.
"""
import re

NUMW = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
        "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fourteen": 14,
        "sixteen": 16, "eighteen": 18, "twenty": 20, "twenty-four": 24, "thirty-two": 32,
        "sixty-four": 64, "a hundred": 100}

LOCAL_HINT = re.compile(
    r"split[- ]?screen|same (?:console|screen|tv|system|device)|local(?:ly)? (?:multiplayer|co-?op|play)"
    r"|system link|lan |hot[- ]?seat|couch|side[-\s]by[-\s]side|pass[- ]the[- ]controller"
    r"|four controllers|two controllers|multiple controllers|offline multiplayer|shared screen"
    r"|\blocally\b|local (?:and|or) online|same room|one console", re.I)
ONLINE_HINT = re.compile(r"online|xbox live|internet|matchmaking|netplay|servers?\b", re.I)
COOP_HINT = re.compile(r"co-?op(?:erative)?(?:\s+(?:mode|play|campaign|multiplayer|gameplay))?|cooperatively", re.I)
VERSUS_HINT = re.compile(
    r"versus|deathmatch|competitive multiplayer|player[- ]versus[- ]player|\bpvp\b|free[- ]for[- ]all"
    r"|capture the flag|team deathmatch|head[- ]to[- ]head|\d+v\d+|against (?:each other|one another|another player)"
    r"|fight(?:ing)? (?:each other|against)|race against", re.I)


def extract_infobox(wikitext):
    """Devolve {param: valor} da primeira Infobox video game."""
    m = re.search(r"\{\{\s*Infobox video game", wikitext or "", re.I)
    if not m:
        return {}
    i, depth, start = m.start(), 0, m.start()
    while i < len(wikitext):
        if wikitext.startswith("{{", i):
            depth += 1; i += 2; continue
        if wikitext.startswith("}}", i):
            depth -= 1; i += 2
            if depth == 0:
                break
            continue
        i += 1
    body = wikitext[start + 2:i - 2]
    out, depth_t, depth_l, depth_b, cur = {}, 0, 0, 0, ""
    parts = []
    k = 0
    while k < len(body):
        if body.startswith("{{", k): depth_t += 1; cur += "{{"; k += 2; continue
        if body.startswith("}}", k): depth_t -= 1; cur += "}}"; k += 2; continue
        if body.startswith("[[", k): depth_l += 1; cur += "[["; k += 2; continue
        if body.startswith("]]", k): depth_l -= 1; cur += "]]"; k += 2; continue
        if body.startswith("<!--", k):
            end = body.find("-->", k); k = (end + 3) if end > 0 else k + 4; continue
        if body[k] == "|" and depth_t == 0 and depth_l == 0 and depth_b == 0:
            parts.append(cur); cur = ""; k += 1; continue
        cur += body[k]; k += 1
    parts.append(cur)
    for p in parts[1:]:
        if "=" in p:
            key, _, val = p.partition("=")
            out[key.strip().lower()] = val.strip()
    return out


def strip_infobox(wikitext):
    """Remove a Infobox contando chaves. (Regex nao-gulosa engolia secoes inteiras quando
    a infobox nao fechava com '\\n}}', apagando o Gameplay de varios artigos.)"""
    m = re.search(r"\{\{\s*Infobox video game", wikitext or "", re.I)
    if not m:
        return wikitext or ""
    i, depth = m.start(), 0
    while i < len(wikitext):
        if wikitext.startswith("{{", i): depth += 1; i += 2; continue
        if wikitext.startswith("}}", i):
            depth -= 1; i += 2
            if depth == 0: break
            continue
        i += 1
    return wikitext[:m.start()] + wikitext[i:]


def _plain(s):
    # ORDEM IMPORTA: refs auto-fechadas primeiro. Se o par <ref>...</ref> rodar antes,
    # um <ref name="x" /> inicia o casamento e engole o texto ate o proximo </ref>.
    s = re.sub(r"<ref[^>]*/\s*>", "", s or "")
    s = re.sub(r"<ref(?![^>]*/>)[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    # expande listas ANTES do strip generico: {{hlist|Single-player|multiplayer}}
    # seria apagado com o miolo, e o jogo sairia como sem modo nenhum
    s = re.sub(r"\{\{(?:hlist|plainlist|ubl|unbulleted list|flatlist)\|(.*?)\}\}",
               lambda m: ", ".join(m.group(1).split("|")), s, flags=re.S | re.I)
    s = re.sub(r"\{\{[^{}]*\}\}", " ", s)
    s = re.sub(r"</?[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s.replace("'''", "").replace("''", ""))


def modes_from_infobox(ib):
    """Le o parametro 'modes' da infobox -> (single, multi) booleanos ou None se ausente."""
    raw = ib.get("modes") or ib.get("mode")
    if not raw:
        return None, None
    t = _plain(raw).lower()
    single = bool(re.search(r"single[- ]?player", t))
    multi = bool(re.search(r"multi[- ]?player|multiplayer|co-?op", t))
    if not single and not multi:
        return None, None
    return single, multi


def _num(tok):
    tok = tok.strip().lower()
    if tok.isdigit():
        n = int(tok)
        return n if 2 <= n <= 256 else None
    return NUMW.get(tok)


def scan_players(text):
    """Varre o texto em busca de contagens de jogadores, classificando local vs online."""
    loc, onl, gen = [], [], []
    sentences = re.split(r"(?<=[.;])\s+", text)
    pats = [re.compile(r"up to (\d+|[a-z\-]+) (?:players|people|participants)", re.I),
            re.compile(r"(\d+|[a-z\-]+)[- ]player", re.I),
            re.compile(r"(?:supports?|allows?|features?) (?:up to )?(\d+|[a-z\-]+) players", re.I)]
    for s in sentences:
        if "player" not in s.lower():
            continue
        found = []
        for p in pats:
            for m in p.finditer(s):
                n = _num(m.group(1))
                if n:
                    found.append(n)
        for m in re.finditer(r"(\d+)\s*(?:v|vs\.?|versus)\s*(\d+)", s, re.I):
            a, b = int(m.group(1)), int(m.group(2))
            if 1 <= a <= 64 and 1 <= b <= 64:
                found.append(a + b)
        if not found:
            continue
        is_loc, is_onl = bool(LOCAL_HINT.search(s)), bool(ONLINE_HINT.search(s))
        if is_loc and not is_onl:
            loc += found
        elif is_onl and not is_loc:
            onl += found
        elif is_loc and is_onl:
            # A frase cita os dois ("12 online ou four em tela dividida"): dar os
            # MESMOS numeros aos dois baldes punha 12 jogadores locais num
            # console de 4 controles. Cada numero vai para a pista mais proxima.
            palavra = {v: k for k, v in NUMW.items()}
            for n in found:
                baixo = s.lower()
                pos = baixo.find(str(n))
                if pos < 0 and n in palavra:      # o texto pode dizer "four", nao "4"
                    pos = baixo.find(palavra[n])
                if pos < 0:
                    gen.append(n); continue
                dl = min((abs(pos - x.start()) for x in LOCAL_HINT.finditer(s)), default=10**6)
                do = min((abs(pos - x.start()) for x in ONLINE_HINT.finditer(s)), default=10**6)
                (loc if dl <= do else onl).append(n)
        else:
            gen += found
    return (max(loc) if loc else 0, max(onl) if onl else 0, max(gen) if gen else 0)


RELEVANT_SEC = re.compile(
    r"^=+\s*(game\s?play|multiplayer|modes?|game modes|features|online|co-?op[^=]*|"
    r"single[- ]player|synopsis|overview|premise)\s*=+\s*$", re.I)


def relevant_text(wikitext):
    """Lead + secoes que descrevem modos de jogo. Evita falso-positivo de Recepcao/
    Desenvolvimento (ex.: uma resenha dizendo 'versus' nao significa que o jogo tem modo versus)."""
    lines = (wikitext or "").split("\n")
    out, keep = [], True
    for ln in lines:
        h = re.match(r"^(=+)\s*(.*?)\s*=+\s*$", ln)
        if h:
            keep = bool(RELEVANT_SEC.match(ln.strip())) if len(h.group(1)) >= 2 else keep
            continue
        if keep:
            out.append(ln)
    txt = "\n".join(out)
    return txt if len(txt) > 200 else (wikitext or "")


def build_tags(wikitext, fallback_multi=None):
    """Analisa o artigo inteiro e devolve o dict de tags do schema do site."""
    ib = extract_infobox(wikitext)
    single, multi = modes_from_infobox(ib)
    body = _plain(relevant_text(strip_infobox(wikitext)))
    low = body.lower()

    if single is None:
        single = True  # padrao: quase todo jogo tem campanha solo
    if multi is None:
        multi = fallback_multi if fallback_multi is not None else bool(
            re.search(r"multi[- ]?player|co-?op|versus mode", low))

    coop = bool(COOP_HINT.search(low))
    versus = bool(VERSUS_HINT.search(low))
    has_local = bool(LOCAL_HINT.search(low))
    has_online = bool(ONLINE_HINT.search(low)) and multi

    pl_loc, pl_onl, pl_gen = scan_players(body)
    if multi and not pl_loc and not pl_onl and pl_gen:
        (pl_loc,) = (pl_gen,) if has_local and not has_online else (0,)
        if not pl_loc:
            pl_onl = pl_gen

    # Defaults: um jogo marcado como multiplayer TEM que sair com ao menos uma tag de
    # multiplayer. Sem pista explicita de online, assume-se local (padrao da era).
    weak = False
    if multi and not has_local and not has_online:
        has_local, weak = True, True
    # multiplayer que nao e cooperativo e, por definicao, competitivo
    if multi and not coop and not versus:
        versus, weak = True, True
    if multi and not pl_loc and not pl_onl and not pl_gen:
        pl_loc = 2 if has_local else 0
        pl_onl = 2 if has_online and not has_local else 0
        weak = True

    if pl_loc > 4:
        pl_loc = 4          # Xbox e Xbox 360 tem 4 portas de controle, sem multitap
    coop_local = coop and has_local
    coop_online = coop and has_online
    versus_local = versus and has_local

    if not multi:
        coop = versus = coop_local = coop_online = versus_local = False
        has_local = has_online = False
        pl_loc = pl_onl = 0

    # A infobox so conta se REALMENTE deu para ler os modos dela. Antes bastava o
    # parametro existir, e um {{hlist}} apagado virava "infobox/high" sem dado.
    leu_infobox = modes_from_infobox(ib) != (None, None)
    conf = "high" if leu_infobox else ("medium" if multi or single else "low")
    if weak and conf == "high":
        conf = "medium"
    elif weak:
        conf = "low"
    return {
        "singlePlayer": bool(single),
        "multiplayerLocal": bool(multi and has_local),
        "multiplayerOnline": bool(has_online),
        "coop": bool(coop), "coopLocal": bool(coop_local), "coopOnline": bool(coop_online),
        "versus": bool(versus), "versusLocal": bool(versus_local),
        "maxPlayersLocal": pl_loc or 0,
        "maxPlayersOnline": pl_onl or 0,
        # sem pl_gen: numeros soltos no texto sao elenco, nao jogadores
        # ("128 players from the World Snooker Tour" virava maxPlayers=128)
        "maxPlayers": max(pl_loc, pl_onl) or 0,
        "source": "wikipedia-infobox" if leu_infobox else "wikipedia-text",
        "confidence": conf,
    }
