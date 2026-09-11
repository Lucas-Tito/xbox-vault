#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera data/tags-homebrew.json (modos de jogo + imagem) para o catalogo homebrew.

Re-executavel: so depende de data/homebrew.json e do cache em cache/.

PREMISSA CENTRAL: homebrew NAO e tudo jogo.
  emulator / utility / dashboard / media  -> NAO tem modo de jogo.
      Todas as flags saem false e os contadores 0, com source "not-a-game".
      O site simplesmente nao mostra tags de modo para esses itens.
      Unica excecao: emuladores de ARCADE/Neo Geo, onde o multiplayer LOCAL do
      sistema emulado e a razao de ser do software (2 jogadores no mesmo Xbox).
  port  -> usa o conhecimento do JOGO ORIGINAL portado (tabela MANUAL abaixo).
  game  -> caso a caso pelo titulo/descricao; sem base -> so singlePlayer, low.

Convencao de numeros (igual a tags-xbox.json):
  maxPlayersLocal  = jogadores no MESMO console (split-screen / varios controles).
  maxPlayersOnline = jogadores em REDE (LAN / system link / internet).
  maxPlayers       = o maior dos dois. 0 = sem informacao (nao e "zero jogadores").
"""
import json
import os
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import wikilib as w   # noqa: E402

IN_PATH = os.path.join(ROOT, "data", "homebrew.json")
OUT_PATH = os.path.join(ROOT, "data", "tags-homebrew.json")

NOT_A_GAME_CATS = {"emulator", "utility", "dashboard", "media"}
MAX_LOCAL = 4          # Xbox e Xbox 360: 4 portas/controles, sem multitap


# --------------------------------------------------------------------------
# helpers de construcao
# --------------------------------------------------------------------------
def not_a_game():
    """Software que nao e jogo: nenhuma tag de modo."""
    return {
        "singlePlayer": False, "multiplayerLocal": False, "multiplayerOnline": False,
        "coop": False, "coopLocal": False, "coopOnline": False,
        "versus": False, "versusLocal": False,
        "maxPlayersLocal": 0, "maxPlayersOnline": 0, "maxPlayers": 0,
        "source": "not-a-game", "confidence": "high",
    }


def mk(sp=True, ml=False, mo=False, cl=False, co=False, vl=False, vo=False,
       loc=0, net=0, conf="medium", source="manual"):
    """Monta uma entrada de jogo.

    sp = single player ; ml/mo = multiplayer local / online
    cl/co = co-op local / online ; vl/vo = versus local / online
    loc/net = jogadores no mesmo console / em rede (0 = desconhecido)
    """
    ml = bool(ml or cl or vl or loc >= 2)
    mo = bool(mo or co or vo or net >= 2)
    return {
        "singlePlayer": bool(sp),
        "multiplayerLocal": ml, "multiplayerOnline": mo,
        "coop": bool(cl or co), "coopLocal": bool(cl), "coopOnline": bool(co),
        "versus": bool(vl or vo), "versusLocal": bool(vl),
        "maxPlayersLocal": loc, "maxPlayersOnline": net,
        "maxPlayers": max(loc, net),
        "source": source, "confidence": conf,
    }


def solo(conf="high"):
    """Jogo exclusivamente single player."""
    return mk(sp=True, conf=conf)


# --------------------------------------------------------------------------
# PORTS (55) - modos vem do JOGO/MOTOR ORIGINAL portado
# --------------------------------------------------------------------------
# Regra usada nos FPS da era DOS (Doom, Duke, Heretic, Hexen, ROTT, Shadow
# Warrior, Descent, Quake): o multiplayer original era em REDE, e os source
# ports normalmente preservam o netcode -> marcado como online, confianca baixa
# quando nao ha confirmacao de que o port especifico manteve a rede.
PORTS = {
    # --- Xbox 360 ---
    # Beats of Rage (Senile Team): beat 'em up com co-op de 2 no mesmo aparelho
    "hb-beats-of-rage-360": mk(cl=True, loc=2, conf="medium"),
    "hb-exult-360": solo(),                 # Ultima VII: so single player
    "hb-flappybird-360": solo(),
    # OpenBOR: motor de beat 'em up, co-op local de ate 4
    "hb-openbor-360": mk(cl=True, loc=4, conf="medium"),
    "hb-openjazz360": solo("medium"),       # OpenJazz roda JJ1, sem multiplayer
    # Quake III Arena: arena de deathmatch, jogo em rede
    "hb-quake3-360": mk(vo=True, net=16, conf="medium"),
    "hb-rawx-360": solo(),                  # Another World
    "hb-reminiscene360": solo(),            # Flashback
    "hb-rick360": solo(),                   # Rick Dangerous
    # Quake 1 (SDL/libXenon): deathmatch e co-op em rede do Quake original
    "hb-sdl-quake-360": mk(vo=True, co=True, net=16, conf="low"),
    # Super Mario War: arena versus local de ate 4
    "hb-super-mario-war-360": mk(vl=True, loc=4, conf="medium"),
    "hb-xbermuda360": solo(),               # Bermuda Syndrome

    # --- Xbox original ---
    "hb-abusex": solo("medium"),            # Abuse: campanha solo
    "hb-avp-xbox": solo("low"),             # AvP 1999; port nao oficial, sem rede
    "hb-beatsofragex": mk(cl=True, loc=2, conf="medium"),
    "hb-cavestoryx": solo(),                # Cave Story: so single player
    "hb-celeste-rxdk": solo(),              # Celeste Classic (PICO-8)
    "hb-cosmo-enginex": solo(),             # Cosmo's Cosmic Adventure
    # dc27-dooom: build minimalista de Chocolate Doom para um CTF
    "hb-dc27-dooom": solo("low"),
    # Doom Legacy: split-screen de 2 + netgame classico de 4 (co-op e deathmatch)
    "hb-doom-legacy-xbox": mk(cl=True, co=True, vl=True, vo=True, loc=2, net=4,
                              conf="medium"),
    # Doom: co-op de 4 e deathmatch
    "hb-doom-x": mk(cl=True, vl=True, loc=4, conf="medium"),
    "hb-exultx": solo(),                    # Ultima VII
    "hb-fallout2-ce-xbox": solo(),
    "hb-fallout1-ce-xbox": solo(),
    "hb-hodex": solo(),                     # Heart of Darkness
    # Mario Kart 64: corrida e batalha em split-screen de ate 4
    "hb-mario-kart-64-x": mk(vl=True, loc=4, conf="medium"),
    "hb-megamanx-x": solo(),
    # Odamex: source port de Doom feito para multiplayer online
    "hb-odamex-xbox": mk(cl=False, co=True, vo=True, net=16, conf="medium"),
    "hb-omnispeakx": solo(),                # Commander Keen
    "hb-openbor-xbox": mk(cl=True, loc=4, conf="medium"),
    "hb-openlara-xbox": solo("medium"),     # Tomb Raider
    "hb-opentyrianx": solo("medium"),       # Tyrian: campanha solo
    # Quake 3 (Xbox): a propria descricao cita "single player e jogo em rede"
    "hb-quake3-xbox": mk(vo=True, net=16, conf="high"),
    "hb-quake2x-le": mk(vo=True, co=True, net=16, conf="medium"),
    "hb-quakex": mk(vo=True, co=True, net=16, conf="low"),
    "hb-raptor-xbox": solo(),               # Raptor: Call of the Shadows
    "hb-rawx": solo(),                      # Another World
    "hb-reminiscencex": solo(),             # Flashback
    # Rise of the Triad: Comm-bat de ate 11 jogadores (co-op e deathmatch)
    "hb-rottx": mk(vo=True, co=True, net=11, conf="low"),
    "hb-sdlpopx": solo(),                   # Prince of Persia 1989
    # Shadow Warrior: co-op e versus em rede (8 jogadores)
    "hb-shadowx": mk(vo=True, co=True, net=8, conf="low"),
    # StepMania: dois tapetes ligados ao mesmo console
    "hb-stepmaniax": mk(vl=True, loc=2, conf="medium"),
    "hb-super-mario-war-xbox": mk(vl=True, loc=4, conf="medium"),
    # Super Mario World/SMB: 2 jogadores alternados, nao simultaneos -> solo
    "hb-super-mario-world-x": solo(),
    "hb-wolf3d-openxdk": solo(),            # Wolfenstein 3D: so single player
    # OpenTTD: multiplayer em rede (competitivo e empresa compartilhada)
    "hb-open-transport-tycoon-xbox": mk(vo=True, co=True, net=0, conf="medium"),
    # Descent (D2X-Rebirth): anarchy e co-op em rede
    "hb-xdescent": mk(vo=True, co=True, net=8, conf="low"),
    # Duke Nukem 3D: co-op + Dukematch (8 jogadores)
    "hb-xduke": mk(vo=True, co=True, net=8, conf="medium"),
    "hb-xheretic": mk(vo=True, co=True, net=4, conf="low"),
    "hb-xhexen": mk(vo=True, co=True, net=4, conf="low"),
    "hb-xrick": solo(),                     # Rick Dangerous
    # Streets of Rage Remake: co-op e versus local de 2
    "hb-xsorr": mk(cl=True, vl=True, loc=2, conf="medium"),
    # The Ur-Quan Masters: campanha solo + Super Melee de 2 no mesmo console
    "hb-xurquan": mk(vl=True, loc=2, conf="medium"),
    "hb-zelda-alttp-x": solo(),
    "hb-zelda-roth-xbox": solo(),           # fangame Solarus
}

# --------------------------------------------------------------------------
# JOGOS AUTORAIS (20) - deduzidos do titulo/descricao
# --------------------------------------------------------------------------
GAMES = {
    # --- Xbox 360 ---
    "hb-little-more-intense-snake": solo("medium"),   # Snake
    "hb-claw-machine-360": solo("medium"),            # simulador de maquina de garra
    "hb-fursan-al-aqsa": solo("medium"),              # FPS de campanha
    "hb-nestbound": solo("medium"),                   # puzzle de tracar linha
    "hb-pacman-colors": solo("medium"),               # clone de Pac-Man
    # Pong: dois jogadores no mesmo console
    "hb-paddle-meyhem": mk(vl=True, loc=2, conf="medium"),
    "hb-pong-360": mk(vl=True, loc=2, conf="low"),
    # QuadCarnage: shooter multiplayer local (quatro jogadores)
    "hb-quadcarnage": mk(vl=True, loc=4, conf="medium"),
    "hb-redpill-360": solo("medium"),                 # plataforma
    "hb-tank360": solo("low"),                        # sem informacao de modos
    "hb-tanks-360": solo("low"),                      # sem informacao de modos
    "hb-wowjay": solo("low"),
    "hb-xbox-invaders": solo("medium"),               # estilo Space Invaders

    # --- Xbox original ---
    "hb-arcadian-tactics": solo("low"),               # estrategia por turnos
    "hb-magnetron": solo("low"),
    "hb-xskull": solo("medium"),                      # plataforma
    "hb-star-wars-xbox-hb": solo("low"),
    "hb-vortexion-xbox": solo("medium"),              # shoot 'em up
    # X-Pong: descrito como "para dois jogadores"
    "hb-x-pong": mk(vl=True, loc=2, conf="medium"),
    # XBomberbox: arena estilo Bomberman, ate 4 no mesmo console
    "hb-xbomberbox": mk(vl=True, loc=4, conf="medium"),
}

# --------------------------------------------------------------------------
# EXCECAO: emuladores de ARCADE / Neo Geo / luta.
# Nao sao jogos, mas o multiplayer LOCAL do sistema emulado (2 jogadores no
# mesmo Xbox, versus/co-op de fliperama) e documentado e e a razao de ser do
# software. Usado com parcimonia: SO arcade/Neo Geo/M.U.G.E.N, nunca emuladores
# de computador ou de console domestico.
# --------------------------------------------------------------------------
ARCADE_LOCAL = {
    "hb-mameox": 2,            # MAMEoX: o port historico do MAME
    "hb-mameoxtras": 2,
    "hb-mame360": 4,           # descricao cita explicitamente 4 jogadores
    "hb-coinops": 2,           # front-end de arcade baseado em MAME
    "hb-final-burn-legends": 2,   # FBA: CPS/Neo Geo
    "hb-final-burn-consoles": 2,  # Neo Geo AES / CPS Changer
    "hb-fbanext-360": 2,
    "hb-fbneo-360": 2,
    "hb-cpx3": 2,              # CPS-3 = Street Fighter III
    "hb-cpx3-360": 2,
    "hb-kixxx": 2,             # Killer Instinct 1 e 2
    "hb-xmugen": 2,            # motor de luta M.U.G.E.N
    "hb-xneoraine": 2,         # Neo Geo CD
    "hb-xraine": 2,            # Raine (arcade)
}


def arcade_exception(n):
    e = not_a_game()
    e.update({"multiplayerLocal": True, "versus": True, "versusLocal": True,
              "maxPlayersLocal": n, "maxPlayers": n,
              "source": "manual", "confidence": "medium"})
    return e


# --------------------------------------------------------------------------
# imagens
# --------------------------------------------------------------------------
def fetch_images(entries):
    """{id: url|None}. So usa o que vier do pageimages da Wikipedia."""
    titles = sorted({e["wiki"] for e in entries if e.get("wiki")})
    print("imagens: consultando %d artigos unicos (%d entradas com wiki)"
          % (len(titles), sum(1 for e in entries if e.get("wiki"))))
    by_title = w.batch_images(titles, size=400) if titles else {}
    out = {}
    for e in entries:
        url = by_title.get(e["wiki"]) if e.get("wiki") else None
        out[e["id"]] = url if (url and str(url).startswith("http")) else None
    faltando = [t for t in titles if t not in by_title]
    if faltando:
        print("  sem imagem na Wikipedia (%d): %s" % (len(faltando), ", ".join(faltando[:10])))
    return out


# --------------------------------------------------------------------------
# validacao logica
# --------------------------------------------------------------------------
def validate(tags, fix=True):
    """Acusa (e opcionalmente conserta) incoerencias. Devolve lista de problemas."""
    issues = []

    def bad(gid, msg):
        issues.append((gid, msg))

    for gid, e in tags.items():
        ml, mo = e["multiplayerLocal"], e["multiplayerOnline"]

        # 1. sem multiplayer nenhum -> nada de coop/versus/contadores
        if not ml and not mo:
            for k in ("coop", "coopLocal", "coopOnline", "versus", "versusLocal"):
                if e[k]:
                    bad(gid, "%s=True sem multiplayer" % k)
                    if fix:
                        e[k] = False
            for k in ("maxPlayersLocal", "maxPlayersOnline", "maxPlayers"):
                if e[k]:
                    bad(gid, "%s=%s sem multiplayer" % (k, e[k]))
                    if fix:
                        e[k] = 0

        # 2. coerencia das sub-flags com o escopo
        if e["coopLocal"] and not ml:
            bad(gid, "coopLocal sem multiplayerLocal")
            if fix:
                e["coopLocal"] = False
        if e["coopOnline"] and not mo:
            bad(gid, "coopOnline sem multiplayerOnline")
            if fix:
                e["coopOnline"] = False
        if e["versusLocal"] and not ml:
            bad(gid, "versusLocal sem multiplayerLocal")
            if fix:
                e["versusLocal"] = False
        if (e["coopLocal"] or e["coopOnline"]) and not e["coop"]:
            bad(gid, "coopLocal/Online sem coop")
            if fix:
                e["coop"] = True
        if e["versusLocal"] and not e["versus"]:
            bad(gid, "versusLocal sem versus")
            if fix:
                e["versus"] = True

        # 3. multiplayer tem que ser coop ou versus
        if (ml or mo) and not (e["coop"] or e["versus"]):
            bad(gid, "multiplayer sem coop nem versus")
            if fix:
                e["versus"] = True
                e["versusLocal"] = ml

        # 4. contadores
        if e["maxPlayersLocal"] and not ml:
            bad(gid, "maxPlayersLocal sem multiplayerLocal")
            if fix:
                e["maxPlayersLocal"] = 0
        if e["maxPlayersOnline"] and not mo:
            bad(gid, "maxPlayersOnline sem multiplayerOnline")
            if fix:
                e["maxPlayersOnline"] = 0
        if e["maxPlayersLocal"] == 1 or e["maxPlayersOnline"] == 1:
            bad(gid, "contador = 1 (multiplayer precisa de >= 2)")
            if fix:
                if e["maxPlayersLocal"] == 1:
                    e["maxPlayersLocal"] = 2
                if e["maxPlayersOnline"] == 1:
                    e["maxPlayersOnline"] = 2
        if e["maxPlayersLocal"] > MAX_LOCAL:
            bad(gid, "maxPlayersLocal > %d" % MAX_LOCAL)
            if fix:
                e["maxPlayersLocal"] = MAX_LOCAL
        mx = max(e["maxPlayersLocal"], e["maxPlayersOnline"])
        if e["maxPlayers"] != mx:
            bad(gid, "maxPlayers (%s) != max(local, online) (%s)" % (e["maxPlayers"], mx))
            if fix:
                e["maxPlayers"] = mx

        # 5. nada de jogo sem nenhum modo
        if not (e["singlePlayer"] or ml or mo) and e["source"] != "not-a-game":
            bad(gid, "jogo sem nenhum modo ativo")
            if fix:
                e["singlePlayer"] = True

        # 6. metadados
        if e["source"] not in ("manual", "not-a-game"):
            bad(gid, "source invalido: %r" % e["source"])
        if e["confidence"] not in ("high", "medium", "low"):
            bad(gid, "confidence invalida: %r" % e["confidence"])
        if e["image"] is not None and not str(e["image"]).startswith("http"):
            bad(gid, "image nao e URL")
            if fix:
                e["image"] = None
        if e["source"] == "not-a-game" and e["singlePlayer"]:
            bad(gid, "not-a-game com singlePlayer=True")
            if fix:
                e["singlePlayer"] = False

    return issues


ORDER = ["image", "singlePlayer", "multiplayerLocal", "multiplayerOnline",
         "coop", "coopLocal", "coopOnline", "versus", "versusLocal",
         "maxPlayersLocal", "maxPlayersOnline", "maxPlayers", "source", "confidence"]


def label(e):
    lab = []
    if e["singlePlayer"]:
        lab.append("1P")
    if e["multiplayerLocal"]:
        lab.append("LOCAL%s" % (e["maxPlayersLocal"] or "?"))
    if e["multiplayerOnline"]:
        lab.append("ONLINE%s" % (e["maxPlayersOnline"] or "?"))
    if e["coop"]:
        lab.append("COOP" + ("L" if e["coopLocal"] else "") + ("O" if e["coopOnline"] else ""))
    if e["versus"]:
        lab.append("VS" + ("L" if e["versusLocal"] else ""))
    return " ".join(lab) or "-"


# --------------------------------------------------------------------------
def main():
    with open(IN_PATH, encoding="utf-8") as f:
        entries = json.load(f)
    print("entrada: %d itens de %s" % (len(entries), os.path.relpath(IN_PATH, ROOT)))
    by_cat = Counter(e["category"] for e in entries)
    print("categorias: %s" % dict(by_cat))

    images = fetch_images(entries)

    manual = {}
    manual.update(PORTS)
    manual.update(GAMES)

    tags = {}
    sem_regra = []
    for e in entries:
        gid, cat = e["id"], e["category"]
        if cat in NOT_A_GAME_CATS:
            t = arcade_exception(ARCADE_LOCAL[gid]) if gid in ARCADE_LOCAL else not_a_game()
        elif gid in manual:
            t = dict(manual[gid])
        else:
            # port/game sem regra explicita: single player, confianca baixa
            sem_regra.append((gid, cat, e["title"]))
            t = solo("low")
        t["image"] = images.get(gid)
        tags[gid] = {k: t[k] for k in ORDER}

    if sem_regra:
        print("\nAVISO: %d itens port/game sem entrada manual (viraram 1P/low):" % len(sem_regra))
        for s in sem_regra:
            print("   ", s)

    orfaos = [k for k in manual if k not in tags]
    if orfaos:
        print("\nAVISO: %d ids na tabela manual que nao existem no catalogo: %s"
              % (len(orfaos), orfaos))

    # ---- validacao ----
    issues = validate(tags, fix=True)
    restantes = validate(tags, fix=False)

    # ---- grava ----
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(tags, f, ensure_ascii=False, indent=1)
    json.loads(open(OUT_PATH, encoding="utf-8").read())   # (b) JSON valido
    print("\ngravado %s (%d entradas, %.1f KB)"
          % (os.path.relpath(OUT_PATH, ROOT), len(tags), os.path.getsize(OUT_PATH) / 1024.0))

    # ==================== RELATORIO ====================
    print("\n" + "=" * 72)
    # (a) cobertura
    ids = [e["id"] for e in entries]
    faltando = [i for i in ids if i not in tags]
    print("(a) cobertura: %d/%d ids presentes; faltando=%d; duplicados=%d"
          % (len(tags), len(ids), len(faltando), len(ids) - len(set(ids))))

    # (b) JSON valido
    print("(b) JSON valido: sim (recarregado do disco)")

    # (c) validador
    print("(c) incoerencias encontradas e corrigidas: %d | restantes: %d"
          % (len(issues), len(restantes)))
    for gid, msg in issues[:15]:
        print("      corrigido: %-32s %s" % (gid, msg))
    for gid, msg in restantes[:15]:
        print("      RESTANTE : %-32s %s" % (gid, msg))

    # (d) quantos tem modo de jogo ativo
    MODE_FLAGS = ("singlePlayer", "multiplayerLocal", "multiplayerOnline",
                  "coop", "versus")
    ativos = [g["id"] for g in entries if any(tags[g["id"]][k] for k in MODE_FLAGS)]
    esperado = by_cat["port"] + by_cat["game"]
    exc = [i for i in ativos if tags[i]["source"] == "manual"
           and next(e for e in entries if e["id"] == i)["category"] in NOT_A_GAME_CATS]
    print("(d) entradas com alguma tag de modo ativa: %d" % len(ativos))
    print("      port+game = %d  +  excecoes de emulador arcade = %d  =  %d  (bate: %s)"
          % (esperado, len(exc), esperado + len(exc), "SIM" if len(ativos) == esperado + len(exc) else "NAO"))
    print("      excecoes: %s" % ", ".join(sorted(exc)))
    nao_jogo = sum(1 for t in tags.values() if t["source"] == "not-a-game")
    print("      not-a-game puros: %d (de %d itens nas categorias nao-jogo)"
          % (nao_jogo, sum(by_cat[c] for c in NOT_A_GAME_CATS)))

    # distribuicoes
    print("\nsource : %s" % dict(Counter(t["source"] for t in tags.values())))
    print("confianca: %s" % dict(Counter(t["confidence"] for t in tags.values())))
    com_img = sum(1 for t in tags.values() if t["image"])
    com_wiki = sum(1 for e in entries if e.get("wiki"))
    print("imagens: %d/%d entradas (%d tem wiki; %d wiki sem imagem)"
          % (com_img, len(tags), com_wiki, com_wiki - com_img))
    per_cat = defaultdict(lambda: [0, 0])
    for e in entries:
        per_cat[e["category"]][0] += 1
        if any(tags[e["id"]][k] for k in MODE_FLAGS):
            per_cat[e["category"]][1] += 1
    print("modo ativo por categoria:")
    for c in sorted(per_cat, key=lambda x: -per_cat[x][0]):
        tot, act = per_cat[c]
        print("    %-10s %3d itens, %3d com modo" % (c, tot, act))

    # (e) spot-check
    print("\n(e) spot-check:")
    spot = ["hb-xbmc", "hb-mameox", "hb-quakex", "hb-doom-x",
            "hb-xexmenu", "hb-retroarch-xbox", "hb-cavestoryx", "hb-freestyle-dash-3"]
    titles = {e["id"]: e["title"] for e in entries}
    cats = {e["id"]: e["category"] for e in entries}
    for gid in spot:
        t = tags.get(gid)
        if not t:
            print("    %-24s AUSENTE" % gid)
            continue
        print("    %-22s %-26s %-10s %-28s img=%-3s %s/%s"
              % (gid, titles[gid][:26], cats[gid], label(t),
                 "sim" if t["image"] else "nao", t["source"], t["confidence"]))


if __name__ == "__main__":
    main()
