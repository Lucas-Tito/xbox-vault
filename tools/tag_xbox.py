#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera data/tags-xbox.json (modos de jogo + capa) para os jogos do Xbox ORIGINAL.

Pipeline (re-executavel, tudo cacheado em cache/):
  1. extracao em massa   : taglib.build_tags(wikitext) + wikilib.batch_images
  2. sanidade de era     : Xbox Live so existe a partir de nov/2002; multiplayer
                           ambiguo nesta geracao e LOCAL (sofa), nao online
  3. System Link (fonte autoritativa para multiplayer local/LAN)
  4. priors por genero   : para jogos sem wiki ou com confidence low
  5. correcoes manuais   : dicionario MANUAL no topo deste arquivo (ultima palavra)
  6. normalizacao + validacao logica + relatorio

Convencao de numeros (igual ao exemplo do schema em Halo: CE):
  maxPlayersLocal  = jogadores no MESMO console (split-screen). Maximo 4 (o Xbox
                     tem 4 portas de controle e nao existe multitap).
  maxPlayersOnline = jogadores em REDE (System Link e/ou Xbox Live).
  maxPlayers       = o maior dos dois. 0 = sem informacao.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import wikilib as w   # noqa: E402
import taglib as t    # noqa: E402

IN_PATH = os.path.join(ROOT, "data", "xbox.json")
OUT_PATH = os.path.join(ROOT, "data", "tags-xbox.json")
SYSLINK_PAGE = "List of Xbox System Link games"

MAX_LOCAL = 4  # Xbox = 4 portas de controle, sem multitap


# --------------------------------------------------------------------------
# 1. CORRECOES MANUAIS (aplicadas DEPOIS da extracao automatica)
# --------------------------------------------------------------------------
def mk(sp=True, ml=None, mo=False, loc=0, net=0, cl=False, co=False, vl=False, vo=False):
    """Monta uma entrada manual completa.

    sp  = single player
    ml  = multiplayer local/LAN (None => deduz de loc >= 2)
    mo  = online de verdade (Xbox Live)
    loc = jogadores no mesmo console (split-screen)
    net = jogadores em rede (system link / Xbox Live)
    cl/co = co-op local / online ; vl/vo = versus local / online
    """
    local = (loc >= 2) if ml is None else bool(ml)
    coop = bool(cl or co)
    versus = bool(vl or vo)
    return {
        "singlePlayer": bool(sp),
        "multiplayerLocal": local,
        "multiplayerOnline": bool(mo),
        "coop": coop, "coopLocal": bool(cl), "coopOnline": bool(co),
        "versus": versus, "versusLocal": bool(vl),
        "maxPlayersLocal": int(loc),
        "maxPlayersOnline": int(net),
        "maxPlayers": max(int(loc), int(net)),
        "source": "manual",
        # NAO e verificacao. Os numeros da tabela MANUAL foram digitados de
        # memoria, sem URL, sem referencia e sem registro de conferencia: das
        # 901 entradas dos dois coletores, nenhuma cita fonte. Alguns estao
        # certos (Halo 3 com 4 em tela dividida e 16 online e conhecido), mas
        # nao ha como separar os certos dos errados sem cruzar com uma fonte
        # de verdade -- e ja houve caso de errar aqui, o 007 Legends com 12
        # jogadores locais que a auditoria pegou. Por isso nao e "high".
        "confidence": "medium",
    }


SOLO = mk()  # apenas single player

MANUAL = {
    # ---- Halo / Bungie -----------------------------------------------------
    "xbox-halo-combat-evolved": mk(loc=4, net=16, cl=True, vl=True, vo=True),
    "xbox-halo-2": mk(loc=4, net=16, mo=True, cl=True, vl=True, vo=True),
    "xbox-halo-2-multiplayer-map-pack": mk(loc=4, net=16, mo=True, cl=True, vl=True, vo=True),

    # ---- RPG / aventura single player --------------------------------------
    "xbox-fable": SOLO,
    "xbox-fable-the-lost-chapters": SOLO,
    "xbox-jade-empire": SOLO,
    "xbox-the-elder-scrolls-iii-morrowind": SOLO,
    "xbox-star-wars-knights-of-the-old-republic": SOLO,
    "xbox-star-wars-knights-of-the-old-republic-ii-the-sith-lords": SOLO,
    "xbox-ninja-gaiden": SOLO,
    "xbox-ninja-gaiden-black": SOLO,
    "xbox-psychonauts": SOLO,
    "xbox-beyond-good-and-evil": SOLO,
    "xbox-the-chronicles-of-riddick-escape-from-butcher-bay": SOLO,
    "xbox-max-payne": SOLO,
    "xbox-max-payne-2-the-fall-of-max-payne": SOLO,
    "xbox-prince-of-persia-the-sands-of-time": SOLO,
    "xbox-prince-of-persia-warrior-within": SOLO,
    "xbox-prince-of-persia-the-two-thrones": SOLO,
    "xbox-grand-theft-auto-iii": SOLO,
    "xbox-grand-theft-auto-vice-city": SOLO,
    "xbox-grand-theft-auto-double-pack": SOLO,
    "xbox-grand-theft-auto-the-trilogy": mk(loc=2, cl=True),  # inclui San Andreas
    "xbox-grand-theft-auto-san-andreas": mk(loc=2, cl=True),
    "xbox-half-life-2": SOLO,
    "xbox-panzer-dragoon-orta": SOLO,
    "xbox-oddworld-munch-s-oddysee": SOLO,
    "xbox-oddworld-stranger-s-wrath": SOLO,
    "xbox-voodoo-vince": SOLO,
    "xbox-azurik-rise-of-perathia": SOLO,
    "xbox-blinx-the-time-sweeper": SOLO,
    "xbox-psi-ops-the-mindgate-conspiracy": SOLO,
    "xbox-silent-hill-2": SOLO,
    "xbox-silent-hill-4-the-room": SOLO,
    "xbox-fatal-frame": SOLO,
    "xbox-fatal-frame-ii-crimson-butterfly-director-s-cut": SOLO,
    "xbox-shenmue-ii": SOLO,
    "xbox-grabbed-by-the-ghoulies": SOLO,
    "xbox-otogi-myth-of-demons": SOLO,
    "xbox-otogi-2-immortal-warriors": SOLO,
    "xbox-sid-meier-s-pirates": SOLO,
    "xbox-indiana-jones-and-the-emperor-s-tomb": SOLO,
    "xbox-the-simpsons-hit-and-run": SOLO,
    "xbox-medal-of-honor-frontline": SOLO,
    "xbox-medal-of-honor-european-assault": SOLO,
    "xbox-tom-clancy-s-splinter-cell": SOLO,
    "xbox-star-wars-obi-wan": SOLO,
    "xbox-fahrenheit": SOLO,
    "xbox-black": SOLO,
    "xbox-advent-rising": SOLO,
    "xbox-the-incredible-hulk-ultimate-destruction": SOLO,
    "xbox-ultimate-spider-man": SOLO,
    "xbox-spider-man-2": SOLO,
    "xbox-tenchu-return-from-darkness": SOLO,
    "xbox-the-matrix-path-of-neo": SOLO,
    "xbox-crazy-taxi-3-high-roller": SOLO,

    # ---- Shooters / acao com multiplayer -----------------------------------
    "xbox-timesplitters-2": mk(loc=4, net=16, cl=True, vl=True),
    "xbox-timesplitters-future-perfect": mk(loc=4, net=16, mo=True, cl=True, vl=True, vo=True),
    "xbox-conker-live-and-reloaded": mk(loc=4, net=16, mo=True, vl=True, vo=True),
    "xbox-unreal-championship": mk(loc=4, net=16, mo=True, vl=True, vo=True),
    "xbox-unreal-championship-2-the-liandri-conflict": mk(loc=4, net=16, mo=True, vl=True, vo=True),
    "xbox-unreal-ii-the-awakening": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-brute-force": mk(loc=4, net=8, cl=True, vl=True),
    "xbox-doom-3": mk(ml=True, net=4, mo=True, co=True, vl=True, vo=True),
    "xbox-doom-3-resurrection-of-evil": mk(ml=True, net=4, mo=True, vl=True, vo=True),
    "xbox-far-cry-instincts": mk(loc=2, net=16, mo=True, vl=True, vo=True),
    "xbox-far-cry-instincts-evolution": mk(loc=2, net=16, mo=True, vl=True, vo=True),
    "xbox-star-wars-battlefront": mk(loc=2, net=24, mo=True, cl=True, vl=True, vo=True),
    "xbox-star-wars-battlefront-ii": mk(loc=2, net=32, mo=True, cl=True, vl=True, vo=True),
    "xbox-star-wars-republic-commando": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-tom-clancy-s-rainbow-six-3": mk(ml=True, net=16, mo=True, cl=True, vl=True, vo=True),
    "xbox-tom-clancy-s-rainbow-six-3-black-arrow": mk(ml=True, net=16, mo=True, cl=True, vl=True, vo=True),
    "xbox-tom-clancy-s-rainbow-six-lockdown": mk(ml=True, net=16, mo=True, cl=True, vo=True),
    "xbox-tom-clancy-s-rainbow-six-critical-hour": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-tom-clancy-s-ghost-recon": mk(ml=True, net=16, mo=True, co=True, vo=True),
    "xbox-tom-clancy-s-ghost-recon-island-thunder": mk(ml=True, net=16, mo=True, co=True, vo=True),
    "xbox-tom-clancy-s-ghost-recon-2": mk(loc=2, net=16, mo=True, cl=True, co=True, vl=True, vo=True),
    "xbox-tom-clancy-s-ghost-recon-2-summit-strike": mk(loc=2, net=16, mo=True, cl=True, co=True, vl=True, vo=True),
    "xbox-tom-clancy-s-ghost-recon-advanced-warfighter": mk(ml=True, net=16, mo=True, co=True, vo=True),
    "xbox-tom-clancy-s-splinter-cell-pandora-tomorrow": mk(ml=True, net=4, mo=True, vo=True),
    "xbox-tom-clancy-s-splinter-cell-chaos-theory": mk(loc=2, net=4, mo=True, cl=True, co=True, vo=True),
    "xbox-tom-clancy-s-splinter-cell-double-agent": mk(ml=True, net=6, mo=True, vo=True),
    "xbox-counter-strike": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-call-of-duty-finest-hour": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-call-of-duty-2-big-red-one": mk(loc=2, net=16, mo=True, cl=True, vo=True),
    "xbox-call-of-duty-3": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-brothers-in-arms-road-to-hill-30": mk(loc=2, net=4, mo=True, vl=True, vo=True),
    "xbox-brothers-in-arms-earned-in-blood": mk(loc=2, net=4, mo=True, cl=True, vl=True, vo=True),
    "xbox-serious-sam": mk(loc=2, net=16, cl=True, vl=True),
    "xbox-serious-sam-2": mk(loc=2, net=16, mo=True, cl=True, co=True, vl=True, vo=True),
    "xbox-medal-of-honor-rising-sun": mk(loc=2, cl=True, vl=True),
    "xbox-freedom-fighters": mk(loc=4, vl=True),
    "xbox-james-bond-007-nightfire": mk(loc=4, vl=True),
    "xbox-james-bond-007-agent-under-fire": mk(loc=4, vl=True),
    "xbox-james-bond-007-everything-or-nothing": mk(loc=2, cl=True),
    "xbox-goldeneye-rogue-agent": mk(loc=4, net=8, mo=True, vl=True, vo=True),
    "xbox-full-spectrum-warrior": mk(loc=2, cl=True),
    "xbox-men-of-valor": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-crimson-skies-high-road-to-revenge": mk(loc=2, net=16, mo=True, co=True, vl=True, vo=True),
    "xbox-mechassault": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-mechassault-2-lone-wolf": mk(loc=2, net=12, mo=True, vl=True, vo=True),
    "xbox-phantasy-star-online-episode-i-and-ii": mk(loc=4, net=4, mo=True, cl=True, co=True),
    "xbox-baldur-s-gate-dark-alliance": mk(loc=2, cl=True),
    "xbox-baldur-s-gate-dark-alliance-ii": mk(loc=2, cl=True),
    "xbox-dungeons-and-dragons-heroes": mk(loc=4, cl=True),
    "xbox-x-men-legends": mk(loc=4, cl=True),
    "xbox-x-men-legends-ii-rise-of-apocalypse": mk(loc=4, cl=True),
    "xbox-the-house-of-the-dead-iii": mk(loc=2, cl=True),
    "xbox-lego-star-wars-the-video-game": mk(loc=2, cl=True),
    "xbox-lego-star-wars-ii-the-original-trilogy": mk(loc=2, cl=True),
    "xbox-the-warriors": mk(loc=2, net=2, mo=True, cl=True, co=True),
    "xbox-the-lord-of-the-rings-the-two-towers": SOLO,
    "xbox-the-lord-of-the-rings-the-return-of-the-king": mk(loc=2, cl=True),
    "xbox-star-wars-jedi-knight-ii-jedi-outcast": SOLO,
    "xbox-star-wars-jedi-knight-jedi-academy": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-star-wars-the-clone-wars": mk(loc=2, cl=True, vl=True),
    "xbox-blood-wake": mk(loc=2, vl=True),
    "xbox-project-snowblind": mk(ml=True, net=8, mo=True, vo=True),
    "xbox-gun": SOLO,
    "xbox-destroy-all-humans": SOLO,
    "xbox-destroy-all-humans-2": mk(loc=2, cl=True),
    "xbox-evil-dead-regeneration": SOLO,
    "xbox-buffy-the-vampire-slayer-chaos-bleeds": mk(loc=2, vl=True),

    # ---- Luta --------------------------------------------------------------
    "xbox-dead-or-alive-3": mk(loc=2, vl=True),
    "xbox-dead-or-alive-1-ultimate": mk(loc=2, vl=True),
    "xbox-dead-or-alive-2-ultimate": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-dead-or-alive-xtreme-beach-volleyball": mk(loc=2, vl=True),
    "xbox-soulcalibur-ii": mk(loc=2, vl=True),
    "xbox-marvel-vs-capcom-2": mk(loc=2, vl=True),
    "xbox-street-fighter-anniversary-collection": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-capcom-vs-snk-2-eo": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-capcom-fighting-evolution": mk(loc=2, vl=True),
    "xbox-capcom-classics-collection-vol-1": mk(loc=2, cl=True, vl=True),
    "xbox-capcom-classics-collection-vol-2": mk(loc=2, cl=True, vl=True),
    "xbox-mortal-kombat-deadly-alliance": mk(loc=2, vl=True),
    "xbox-mortal-kombat-deception": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-mortal-kombat-armageddon": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-mortal-kombat-shaolin-monks": mk(loc=2, cl=True, vl=True),
    "xbox-guilty-gear-x2-reload": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-guilty-gear-isuka": mk(loc=4, vl=True),
    "xbox-the-king-of-fighters-2002": mk(loc=2, vl=True),
    "xbox-the-king-of-fighters-2003": mk(loc=2, vl=True),
    "xbox-the-king-of-fighters-neowave": mk(loc=2, vl=True),
    "xbox-tao-feng-fist-of-the-lotus": mk(loc=2, vl=True),
    "xbox-kakuto-chojin-back-alley-brutal": mk(loc=2, vl=True),
    "xbox-x-men-next-dimension": mk(loc=2, vl=True),
    "xbox-def-jam-fight-for-ny": mk(loc=4, vl=True),
    "xbox-wwe-raw-2": mk(loc=4, vl=True),
    "xbox-wwf-raw": mk(loc=4, vl=True),
    "xbox-wwe-wrestlemania-21": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-fight-night-2004": mk(loc=2, vl=True),
    "xbox-fight-night-round-2": mk(loc=2, vl=True),
    "xbox-fight-night-round-3": mk(loc=2, vl=True),
    "xbox-mike-tyson-heavyweight-boxing": mk(loc=2, vl=True),
    "xbox-godzilla-destroy-all-monsters-melee": mk(loc=4, vl=True),
    "xbox-digimon-rumble-arena-2": mk(loc=4, vl=True),
    "xbox-dragon-ball-z-sagas": mk(loc=2, cl=True),
    "xbox-deathrow": mk(loc=4, net=8, vl=True),
    "xbox-kung-fu-chaos": mk(loc=4, vl=True),
    "xbox-kabuki-warriors": mk(loc=2, vl=True),
    "xbox-bruce-lee-quest-of-the-dragon": SOLO,
    "xbox-iron-phoenix": mk(loc=4, net=4, mo=True, vl=True, vo=True),

    # ---- Festa / party -----------------------------------------------------
    "xbox-fuzion-frenzy": mk(loc=4, vl=True),
    "xbox-whacked": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-shrek-super-party": mk(loc=4, vl=True),
    "xbox-shrek-superslam": mk(loc=4, vl=True),
    "xbox-worms-3d": mk(loc=4, vl=True),
    "xbox-worms-4-mayhem": mk(loc=4, vl=True),
    "xbox-worms-forts-under-siege": mk(loc=4, vl=True),
    "xbox-karaoke-revolution": mk(loc=4, vl=True),
    "xbox-karaoke-revolution-party": mk(loc=4, vl=True),
    "xbox-dance-dance-revolution-ultramix": mk(loc=2, vl=True),
    "xbox-dance-dance-revolution-ultramix-2": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-dance-dance-revolution-ultramix-3": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-dance-dance-revolution-ultramix-4": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-pinball-hall-of-fame": mk(loc=4, vl=True),
    "xbox-toejam-and-earl-iii-mission-to-earth": mk(loc=2, cl=True),

    # ---- Corrida -----------------------------------------------------------
    "xbox-project-gotham-racing": mk(loc=2, vl=True),
    "xbox-project-gotham-racing-2": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-forza-motorsport": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-midtown-madness-3": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-rallisport-challenge": mk(loc=4, vl=True),
    "xbox-rallisport-challenge-2": mk(loc=4, net=8, mo=True, vl=True, vo=True),
    "xbox-burnout": mk(loc=2, vl=True),
    "xbox-burnout-2-point-of-impact": mk(loc=2, vl=True),
    "xbox-burnout-3-takedown": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-burnout-revenge": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-need-for-speed-hot-pursuit-2": mk(loc=2, vl=True),
    "xbox-need-for-speed-underground": mk(loc=2, vl=True),
    "xbox-need-for-speed-underground-2": mk(loc=2, net=4, mo=True, vl=True, vo=True),
    "xbox-need-for-speed-most-wanted": mk(loc=2, vl=True),
    "xbox-need-for-speed-carbon": mk(loc=2, net=4, mo=True, vl=True, vo=True),
    "xbox-motogp-ultimate-racing-technology": mk(loc=2, net=16, mo=True, vl=True, vo=True),
    "xbox-motogp-ultimate-racing-technology-2": mk(loc=2, net=16, mo=True, vl=True, vo=True),
    "xbox-motogp-ultimate-racing-technology-3": mk(loc=2, net=16, mo=True, vl=True, vo=True),
    "xbox-sega-gt-2002": mk(loc=2, vl=True),
    "xbox-sega-gt-online": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-outrun-2": mk(loc=2, net=2, mo=True, vl=True, vo=True),
    "xbox-outrun-2006-coast-2-coast": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-midnight-club-ii": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-midnight-club-3-dub-edition": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-crash-nitro-kart": mk(loc=4, vl=True),
    "xbox-crash-tag-team-racing": mk(loc=4, vl=True),
    "xbox-the-simpsons-road-rage": mk(loc=2, vl=True),
    "xbox-arctic-thunder": mk(loc=4, vl=True),
    "xbox-smashing-drive": mk(loc=2, vl=True),
    "xbox-juiced": mk(loc=2, net=6, mo=True, vl=True, vo=True),
    "xbox-colin-mcrae-rally-2005": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-toca-race-driver-2": mk(loc=2, net=12, mo=True, vl=True, vo=True),
    "xbox-toca-race-driver-3": mk(loc=2, net=12, mo=True, vl=True, vo=True),

    # ---- Esportes / skate --------------------------------------------------
    "xbox-tony-hawk-s-pro-skater-2x": mk(loc=2, vl=True),
    "xbox-tony-hawk-s-pro-skater-3": mk(loc=2, vl=True),
    "xbox-tony-hawk-s-pro-skater-4": mk(loc=2, vl=True),
    "xbox-tony-hawk-s-underground": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-tony-hawk-s-underground-2": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-tony-hawk-s-american-wasteland": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-tony-hawk-s-project-8": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-ssx-tricky": mk(loc=2, vl=True),
    "xbox-ssx-3": mk(loc=2, net=4, mo=True, vl=True, vo=True),
    "xbox-ssx-on-tour": mk(loc=2, vl=True),
    "xbox-amped-freestyle-snowboarding": mk(loc=2, vl=True),
    "xbox-amped-2": mk(loc=2, net=8, mo=True, vl=True, vo=True),
    "xbox-top-spin": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-links-2004": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-jam": mk(loc=4, vl=True),
    "xbox-nba-street-vol-2": mk(loc=4, vl=True),
    "xbox-nba-street-v3": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nfl-street": mk(loc=4, vl=True),
    "xbox-nfl-street-2": mk(loc=4, vl=True),
    "xbox-fifa-street": mk(loc=4, vl=True),
    "xbox-fifa-street-2": mk(loc=4, vl=True),
    "xbox-nfl-blitz-2002": mk(loc=4, vl=True),
    "xbox-nfl-blitz-2003": mk(loc=4, vl=True),
    "xbox-nfl-blitz-pro": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-hitz-2002": mk(loc=4, vl=True),
    "xbox-nhl-hitz-2003": mk(loc=4, vl=True),
    "xbox-nhl-hitz-pro": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-mlb-slugfest-2003": mk(loc=4, vl=True),
    "xbox-mlb-slugfest-2004": mk(loc=4, vl=True),
    "xbox-mlb-slugfest-loaded": mk(loc=4, vl=True),
    "xbox-mlb-slugfest-2006": mk(loc=4, vl=True),
    # EA Sports so entrou no Xbox Live no outono de 2004
    "xbox-madden-nfl-2002": mk(loc=4, vl=True),
    "xbox-madden-nfl-2003": mk(loc=4, vl=True),
    "xbox-madden-nfl-2004": mk(loc=4, vl=True),
    "xbox-madden-nfl-2005": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-madden-nfl-06": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-madden-nfl-07": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-madden-nfl-08": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-madden-nfl-09": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-live-2002": mk(loc=4, vl=True),
    "xbox-nba-live-2003": mk(loc=4, vl=True),
    "xbox-nba-live-2004": mk(loc=4, vl=True),
    "xbox-nba-live-2005": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-live-06": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-live-07": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-2002": mk(loc=4, vl=True),
    "xbox-nhl-2003": mk(loc=4, vl=True),
    "xbox-nhl-2004": mk(loc=4, vl=True),
    "xbox-nhl-2005": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-06": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-07": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-fifa-football-2003": mk(loc=4, vl=True),
    "xbox-fifa-football-2004": mk(loc=4, vl=True),
    "xbox-fifa-football-2005": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-fifa-06": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-fifa-07": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-2002-fifa-world-cup": mk(loc=4, vl=True),
    "xbox-2006-fifa-world-cup": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    # Microsoft / Sega Sports: Xbox Live desde o lancamento do servico
    "xbox-nfl-fever-2002": mk(loc=4, vl=True),
    "xbox-nfl-fever-2003": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nfl-fever-2004": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-inside-drive-2002": mk(loc=4, vl=True),
    "xbox-nba-inside-drive-2003": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-inside-drive-2004": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nfl-2k2": mk(loc=4, vl=True),
    "xbox-nfl-2k3": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-2k2": mk(loc=4, vl=True),
    "xbox-nba-2k3": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-2k6": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nba-2k7": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-2k3": mk(loc=4, vl=True),
    "xbox-nhl-2k6": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-nhl-2k7": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nfl-football": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nba-basketball": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nhl-hockey": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nfl-2k5": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nba-2k5": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-nhl-2k5": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-major-league-baseball": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-espn-college-hoops": mk(loc=4, vl=True),
    "xbox-espn-college-hoops-2k5": mk(loc=4, net=4, mo=True, vl=True, vo=True),
    "xbox-outlaw-golf": mk(loc=4, vl=True),
    "xbox-outlaw-golf-2": mk(loc=4, vl=True),
    "xbox-outlaw-volleyball": mk(loc=4, vl=True),
    "xbox-outlaw-tennis": mk(loc=4, vl=True),
    "xbox-dave-mirra-freestyle-bmx-2": mk(loc=2, vl=True),
    "xbox-aggressive-inline": mk(loc=2, vl=True),
    "xbox-mat-hoffman-s-pro-bmx-2": mk(loc=2, vl=True),
    "xbox-transworld-surf": mk(loc=2, vl=True),
    "xbox-wakeboarding-unleashed-featuring-shaun-murray": mk(loc=2, vl=True),
    "xbox-mx-unleashed": mk(loc=2, vl=True),
    "xbox-mx-vs-atv-unleashed": mk(loc=4, net=6, mo=True, vl=True, vo=True),
    "xbox-atv-quad-power-racing-2": mk(loc=4, vl=True),
    # falsos positivos de online em 2002 (o artigo fala de versao/servico posterior)
    "xbox-mx-superfly": mk(loc=2, vl=True),
    "xbox-outlaw-golf-9-holes-of-x-mas": mk(loc=4, vl=True),
    "xbox-outlaw-golf-9-more-holes-of-x-mas": mk(loc=4, vl=True),
    "xbox-tetris-worlds": mk(loc=4, vl=True),
}

# Segunda leva: co-op de sofa e party games -- exatamente o que a heuristica de
# texto mais erra (o artigo raramente diz "2-player co-op" com essas palavras).
MANUAL.update({
    "xbox-gauntlet-dark-legacy": mk(loc=4, cl=True),
    "xbox-gauntlet-seven-sorrows": mk(loc=4, cl=True),
    "xbox-hunter-the-reckoning": mk(loc=4, cl=True),
    "xbox-hunter-the-reckoning-redeemer": mk(loc=2, cl=True),
    "xbox-marvel-ultimate-alliance": mk(loc=4, cl=True),
    "xbox-marvel-nemesis-rise-of-the-imperfects": mk(loc=2, vl=True),
    "xbox-justice-league-heroes": mk(loc=2, cl=True),
    "xbox-teenage-mutant-ninja-turtles": mk(loc=4, cl=True),
    "xbox-teenage-mutant-ninja-turtles-2-battle-nexus": mk(loc=4, cl=True, vl=True),
    "xbox-teenage-mutant-ninja-turtles-3-mutant-nightmare": mk(loc=2, cl=True),
    "xbox-conflict-desert-storm": mk(loc=4, cl=True),
    "xbox-conflict-desert-storm-ii": mk(loc=4, cl=True),
    "xbox-conflict-vietnam": mk(loc=4, cl=True),
    "xbox-conflict-global-terror": mk(loc=4, net=4, cl=True),
    "xbox-spyhunter-2": mk(loc=2, cl=True),
    "xbox-sniper-elite": mk(loc=2, net=2, mo=True, cl=True, co=True, vl=True, vo=True),
    "xbox-dynasty-warriors-3": mk(loc=2, cl=True, vl=True),
    "xbox-dynasty-warriors-4": mk(loc=2, cl=True, vl=True),
    "xbox-dynasty-warriors-5": mk(loc=2, cl=True, vl=True),
    "xbox-samurai-warriors": mk(loc=2, cl=True, vl=True),
    "xbox-metal-slug-3": mk(loc=2, cl=True),
    "xbox-metal-slug-4": mk(loc=2, cl=True),
    "xbox-metal-slug-5": mk(loc=2, cl=True),
    "xbox-midway-arcade-treasures": mk(loc=4, cl=True, vl=True),
    "xbox-midway-arcade-treasures-2": mk(loc=4, cl=True, vl=True),
    "xbox-midway-arcade-treasures-3": mk(loc=4, cl=True, vl=True),
    "xbox-atari-anthology": mk(loc=2, vl=True),
    "xbox-intellivision-lives": mk(loc=2, vl=True),
    "xbox-taito-legends": mk(loc=2, cl=True, vl=True),
    "xbox-taito-legends-2": mk(loc=2, cl=True, vl=True),
    "xbox-namco-museum": mk(loc=2, vl=True),
    "xbox-namco-museum-50th-anniversary": mk(loc=2, vl=True),
    "xbox-phantom-dust": mk(ml=True, net=4, mo=True, vo=True),
    "xbox-kingdom-under-fire-the-crusaders": mk(ml=True, net=4, mo=True, co=True, vo=True),
    "xbox-kingdom-under-fire-heroes": mk(ml=True, net=4, mo=True, co=True, vo=True),
    "xbox-sudeki": SOLO,
    "xbox-sega-soccer-slam": mk(loc=4, vl=True),
    "xbox-mad-dash-racing": mk(loc=4, vl=True),
    "xbox-rayman-arena": mk(loc=4, vl=True),
    "xbox-rayman-3-hoodlum-havoc": mk(loc=2, vl=True),
    "xbox-blinx-2-masters-of-time-and-space": mk(loc=2, vl=True),
    "xbox-jet-set-radio-future": mk(loc=2, vl=True),
    "xbox-crash-bandicoot-the-wrath-of-cortex": SOLO,
    "xbox-crash-twinsanity": SOLO,
    "xbox-scooby-doo-mystery-mayhem": SOLO,
    "xbox-scooby-doo-night-of-100-frights": SOLO,
    "xbox-scooby-doo-unmasked": SOLO,
    "xbox-monopoly-party": mk(loc=4, vl=True),
    "xbox-nickelodeon-party-blast": mk(loc=4, vl=True),
    "xbox-world-championship-poker": mk(loc=4, vl=True),
    "xbox-world-championship-poker-2-featuring-howard-lederer": mk(loc=4, vl=True),
    "xbox-world-poker-tour": mk(loc=4, vl=True),
    "xbox-world-series-of-poker": mk(loc=4, vl=True),
    "xbox-chessmaster": mk(loc=2, vl=True),
    "xbox-star-wars-jedi-starfighter": mk(loc=2, cl=True),
    "xbox-the-lord-of-the-rings-the-third-age": SOLO,
    "xbox-enter-the-matrix": SOLO,
    "xbox-hulk": SOLO,
    "xbox-batman-begins": SOLO,
    "xbox-van-helsing": SOLO,
    "xbox-spider-man": SOLO,
    "xbox-spyro-a-hero-s-tail": SOLO,
    "xbox-the-warriors": mk(loc=2, net=2, mo=True, cl=True, co=True),
    # tem campanha solo, apesar de a infobox so listar multiplayer
    "xbox-america-s-army-rise-of-a-soldier": mk(ml=True, net=16, mo=True, vo=True),
    "xbox-greg-hastings-tournament-paintball": mk(loc=2, net=14, mo=True, vl=True, vo=True),
    "xbox-greg-hastings-tournament-paintball-max-d": mk(loc=2, net=14, mo=True, cl=True, vl=True, vo=True),
})

# --------------------------------------------------------------------------
# 2. Jogos SEM artigo na Wikipedia: genero informado na mao (prior)
#    'single' | 'versus:<n>' | 'coop:<n>'
# --------------------------------------------------------------------------
NOWIKI_GENRE = {
    "xbox-angelic-concert": "single",
    "xbox-aoi-namida": "single",
    "xbox-the-baseball-2002-battle-ball-park-sengen": "versus:2",
    "xbox-bass-pro-shops-trophy-bass-2007": "versus:2",
    "xbox-bistro-cupid": "single",
    "xbox-bistro-cupid-2": "single",
    "xbox-braveknight": "single",
    "xbox-break-nine-world-billiards-tournament": "versus:2",
    "xbox-championship-bowling": "versus:4",
    "xbox-daemon-vector-gui-yi": "single",
    "xbox-dance-uk": "versus:2",
    "xbox-dennou-taisen-dronez": "versus:2",
    "xbox-dinosaur-hunting": "single",
    "xbox-double-s-t-e-a-l-the-second-clash": "versus:2",
    "xbox-exaskeleton": "single",
    "xbox-fila-world-tour-tennis": "versus:4",
    "xbox-flight-academy": "single",
    "xbox-furious-karting": "versus:4",
    "xbox-gene-troopers": "single",
    "xbox-the-hustle-detroit-streets": "versus:4",
    "xbox-innocent-tears": "single",
    "xbox-inside-pitch-2003": "versus:2",
    "xbox-iron-phoenix": "versus:4",
    "xbox-jacked": "versus:2",
    "xbox-jockey-s-road": "single",
    "xbox-kikou-heidan-j-phoenix-plus": "versus:2",
    "xbox-magatama": "single",
    "xbox-magi-death-fight-mahou-gakuen": "versus:2",
    "xbox-miami-vice": "single",
    "xbox-muzzle-flash": "single",
    "xbox-nakajima-tetsuya-no-othello-seminar": "versus:2",
    "xbox-nba-starting-five": "versus:4",
    "xbox-pilot-down-behind-enemy-lines": "single",
    "xbox-plus-plumb-2": "versus:2",
    "xbox-pro-cast-sports-fishing": "versus:2",
    "xbox-rapala-pro-fishing": "versus:2",
    "xbox-room-zoom": "versus:2",
    "xbox-sentou-yousei-yukikaze-yousei-no-mau-sora": "single",
    "xbox-shinchou-mahjong": "versus:4",
    "xbox-ski-racing-2005": "versus:2",
    "xbox-ski-racing-2006": "versus:2",
    "xbox-slam-tennis": "versus:4",
    "xbox-takahashi-junko-no-mahjong-seminar": "versus:4",
    "xbox-tenerezza": "single",
    "xbox-tennis-masters-series-2003": "versus:4",
    "xbox-thousand-land": "single",
    "xbox-touge-r": "versus:2",
    "xbox-tour-de-france": "versus:2",
    "xbox-triangle-again": "versus:2",
    "xbox-triangle-again-2": "versus:2",
    "xbox-umezawa-yukari-no-igo-seminar": "versus:2",
    "xbox-volvo-drive-for-life": "versus:2",
    "xbox-the-wild-rings": "versus:2",
    "xbox-yetisports-arctic-adventures": "versus:4",
    "xbox-yonenaga-kunio-no-shougi-seminar": "versus:2",
    "xbox-zillernet": "single",
}

# --------------------------------------------------------------------------
# 3. Sanidade de era
# --------------------------------------------------------------------------
# Xbox Live foi lancado em 15/11/2002. Jogos de 2001 NUNCA tem online;
# de 2002 so a leva de lancamento do servico (e o artigo precisa citar "Xbox Live").
LIVE_2002 = {
    "xbox-mechassault", "xbox-unreal-championship", "xbox-nfl-fever-2003",
    "xbox-nba-inside-drive-2003", "xbox-motogp-ultimate-racing-technology",
    "xbox-whacked", "xbox-tom-clancy-s-ghost-recon", "xbox-nfl-2k3",
    "xbox-nba-2k3", "xbox-capcom-vs-snk-2-eo",
}

# evidencia forte de jogo online de verdade (nao basta a palavra "online" solta)
STRICT_ONLINE = re.compile(
    r"xbox\s*live"
    r"|online\s+(?:multi-?player|play|mode|modes|match|matches|matchmaking|gam(?:e|es|ing)|"
    r"component|features?|co-?op|competition|leaderboards?|rankings?|servers?)"
    r"|multi-?player[^.]{0,40}\bonline\b"
    r"|play(?:ed|able|ing|s)?\s+(?:it\s+|the\s+game\s+)?online"
    r"|\bonline\b[^.]{0,30}(?:against|versus|with other|other players)"
    r"|over\s+the\s+internet|internet\s+(?:play|multi-?player)"
    r"|online\s+(?:and|or)\s+(?:offline|local|split)",
    re.I)

SPLITSCREEN_HINT = re.compile(
    r"split[- ]?screen|same (?:console|screen|tv|system)|two controllers|four controllers"
    r"|shared screen|couch|hot[- ]?seat", re.I)

# --------------------------------------------------------------------------
# 4. Priors por genero (jogos com confidence low)
# --------------------------------------------------------------------------
TEAM_SPORT = re.compile(
    r"basketball|football|soccer|hockey|baseball|rugby|cricket|volleyball|handball", re.I)


def genre_prior(genre_text, title=""):
    """Devolve ('single'|'versus'|'coop', n_jogadores) a partir do genero."""
    g = ((genre_text or "") + " " + (title or "")).lower()
    if re.search(r"party|mini-?game|minigame|quiz|trivia|board game", g):
        return ("versus", 4)
    if re.search(r"fighting|beat[- ']?em[- ]?up|versus fighting|wrestling", g):
        return ("versus", 2)
    if re.search(r"kart|party racing", g):
        return ("versus", 4)
    if re.search(r"racing|driving|rally|motocross", g):
        return ("versus", 2)
    if re.search(r"sports?|golf|tennis|bowling|billiards|pool|fishing|skateboard|snowboard|bmx", g):
        return ("versus", 4 if TEAM_SPORT.search(g) else 2)
    if re.search(r"first-?person shooter|\bfps\b|shooter|shoot['’]?em[- ]?up", g):
        return ("versus", 4)
    if re.search(r"puzzle|card|mahjong|chess|shogi|go\b|othello|casino|pinball", g):
        return ("versus", 2)
    if re.search(r"music|rhythm|dance|karaoke", g):
        return ("versus", 2)
    if re.search(r"real-?time strategy|\brts\b|vehicular combat|flight simulat", g):
        return ("versus", 2)
    return ("single", 0)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def fetch_images(titles, size=400):
    """{titulo_pedido: url_da_capa}.

    wikilib.batch_images usa os defaults de pageimages (pilimit=1, pilicense=free),
    e capa de jogo na Wikipedia e imagem NAO-livre (fair use) -> voltava quase tudo
    vazio. Aqui a mesma API e chamada com pilimit=50 e pilicense=any, reaproveitando
    o cache em disco de wikilib.api. Nenhuma URL e inventada: todas vem da API.
    """
    out = {}
    titles = list(titles)
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        d = w.api({"action": "query", "prop": "pageimages",
                   "piprop": "thumbnail|original", "pithumbsize": str(size),
                   "pilimit": "50", "pilicense": "any", "redirects": "1",
                   "titles": "|".join(chunk)})
        q = d.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        by_title = {}
        for p in q.get("pages", []):
            src = (p.get("thumbnail") or {}).get("source") or \
                  (p.get("original") or {}).get("source")
            if src:
                by_title[p["title"]] = src.split("?")[0]
        for t_ in chunk:
            r = redir.get(norm.get(t_, t_), norm.get(t_, t_))
            if r in by_title:
                out[t_] = by_title[r]
    return out


def norm_key(s):
    s = (s or "").lower()
    s = s.replace("&", " and ").replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"^(the|a)\s+", "", s)
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def num_cell(c):
    m = re.search(r"\d+", c or "")
    return int(m.group()) if m else 0


def blank_tags():
    return {
        "singlePlayer": True, "multiplayerLocal": False, "multiplayerOnline": False,
        "coop": False, "coopLocal": False, "coopOnline": False,
        "versus": False, "versusLocal": False,
        "maxPlayersLocal": 0, "maxPlayersOnline": 0, "maxPlayers": 0,
        "source": "genre-prior", "confidence": "low",
    }


def apply_prior(e, kind, n):
    """Aplica prior de genero sobre uma entrada de baixa confianca."""
    if kind == "single":
        e.update({"multiplayerLocal": False, "multiplayerOnline": False,
                  "coop": False, "coopLocal": False, "coopOnline": False,
                  "versus": False, "versusLocal": False,
                  "maxPlayersLocal": 0, "maxPlayersOnline": 0, "maxPlayers": 0})
    elif kind == "coop":
        e.update({"multiplayerLocal": True, "coop": True, "coopLocal": True,
                  "maxPlayersLocal": max(e["maxPlayersLocal"], n)})
    else:
        e.update({"multiplayerLocal": True, "versus": True, "versusLocal": True,
                  "maxPlayersLocal": max(e["maxPlayersLocal"], n)})
    e["singlePlayer"] = True
    e["source"] = "genre-prior"
    e["confidence"] = "low"
    return e


def normalize(e, allow_net_without_online=False, no_local_floor=False):
    """Coerencia logica + limites da plataforma. Devolve lista de correcoes feitas."""
    fixes = []
    ml, mo = bool(e["multiplayerLocal"]), bool(e["multiplayerOnline"])

    if not ml and not mo:
        for k in ("coop", "coopLocal", "coopOnline", "versus", "versusLocal"):
            if e[k]:
                e[k] = False
                fixes.append(k + "-sem-multiplayer")
        for k in ("maxPlayersLocal", "maxPlayersOnline", "maxPlayers"):
            if e[k]:
                e[k] = 0
                fixes.append(k + "-sem-multiplayer")
        e["singlePlayer"] = True
        return fixes

    if e["coopLocal"] and not ml:
        e["coopLocal"] = False; fixes.append("coopLocal-sem-local")
    if e["coopOnline"] and not mo:
        e["coopOnline"] = False; fixes.append("coopOnline-sem-online")
    if e["versusLocal"] and not ml:
        e["versusLocal"] = False; fixes.append("versusLocal-sem-local")
    if e["coop"] and not (e["coopLocal"] or e["coopOnline"]):
        e["coopLocal"] = ml
        e["coopOnline"] = mo and not ml
        fixes.append("coop-sem-escopo")
    if (e["coopLocal"] or e["coopOnline"]) and not e["coop"]:
        e["coop"] = True; fixes.append("coop-implicito")
    if e["versus"] and not e["versusLocal"] and ml and not mo:
        e["versusLocal"] = True; fixes.append("versus-local-implicito")
    if e["versusLocal"] and not e["versus"]:
        e["versus"] = True; fixes.append("versus-implicito")
    if not e["coop"] and not e["versus"]:
        # multiplayer que nao e cooperativo e, por definicao, competitivo
        e["versus"] = True
        e["versusLocal"] = ml
        fixes.append("versus-default")

    # o Xbox tem 4 portas de controle: mais que isso so em rede
    if e["maxPlayersLocal"] > MAX_LOCAL:
        e["maxPlayers"] = max(e["maxPlayers"], e["maxPlayersLocal"])
        e["maxPlayersOnline"] = max(e["maxPlayersOnline"], e["maxPlayersLocal"]) \
            if (mo or allow_net_without_online) else e["maxPlayersOnline"]
        e["maxPlayersLocal"] = 0
        fixes.append("local>4-movido-para-rede")
    if ml and e["maxPlayersLocal"] == 0 and not no_local_floor:
        e["maxPlayersLocal"] = 2
    if mo and e["maxPlayersOnline"] == 0:
        e["maxPlayersOnline"] = 2
    if not mo and not allow_net_without_online and e["maxPlayersOnline"]:
        e["maxPlayers"] = max(e["maxPlayers"], e["maxPlayersOnline"])
        e["maxPlayersOnline"] = 0
        fixes.append("online-players-sem-online")
    # derivado, nunca acumulado: manter um valor antigo deixava numeros orfaos
    # (128 do "World Snooker Tour" sobrevivia ao rebaixamento para local)
    e["maxPlayers"] = max(e["maxPlayersLocal"], e["maxPlayersOnline"])
    return fixes


# --------------------------------------------------------------------------
# System Link
# --------------------------------------------------------------------------
def load_syslink():
    """{chave_normalizada: {...}} a partir de List of Xbox System Link games."""
    wt = w.fetch_wikitext(SYSLINK_PAGE)
    # iter_table_rows so ancora a tabela por id=; a pagina nao tem um, entao
    # marcamos a tabela alvo (workaround; wikilib nao pode ser alterado).
    wt = wt.replace('{| class="wikitable sortable"',
                    '{| id="softwarelist" class="wikitable sortable"', 1)
    rows = list(w.iter_table_rows(wt))
    out, header = {}, None
    for cells in rows:
        if header is None:
            header = [w.strip_wiki(re.sub(r'^[^|]*\|', '', c)) for c in cells]
            print("  cabecalho System Link:", header)
            continue
        if len(cells) < 3:
            continue
        title_cell = cells[0]
        art = w.link_target(title_cell)
        disp = w.strip_wiki(title_cell)
        rec = {
            "article": art, "display": disp,
            "total": num_cell(cells[1]),
            "per_console": num_cell(cells[2]),
            "versus": num_cell(cells[3]) if len(cells) > 3 else 0,
            "coop": num_cell(cells[4]) if len(cells) > 4 else 0,
            "notes": w.strip_wiki(cells[5]) if len(cells) > 5 else "",
        }
        for k in (art, disp):
            if k:
                out.setdefault(norm_key(k), rec)
    return out


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    games = json.load(open(IN_PATH, encoding="utf-8"))
    print("jogos em data/xbox.json: %d" % len(games))
    wikis = [g["wiki"] for g in games if g.get("wiki")]
    print("com artigo na Wikipedia: %d" % len(wikis))

    print("\n[1/6] baixando wikitext (%d artigos, cache em disco)..." % len(wikis))
    texts = w.batch_wikitext(wikis)
    print("      wikitext obtido: %d" % len(texts))
    print("[1/6] baixando capas (pageimages)...")
    images = fetch_images(wikis, size=400)
    for k, v in w.batch_images(wikis, size=400).items():
        images.setdefault(k, v)
    print("      capas obtidas: %d" % len(images))

    print("\n[2/6] System Link...")
    syslink = load_syslink()
    print("      linhas indexadas: %d chaves" % len(syslink))

    tags, meta = {}, {}
    for g in games:
        gid, wiki, year = g["id"], g.get("wiki"), g.get("year")
        wt = texts.get(wiki) if wiki else None
        if wt:
            e = t.build_tags(wt)
            genre = t._plain(t.extract_infobox(wt).get("genre", ""))
        else:
            e = blank_tags()
            genre = ""
        e["image"] = images.get(wiki) if wiki else None
        tags[gid] = e
        meta[gid] = {"wt": wt or "", "genre": genre, "year": year,
                     "title": g["title"], "wiki": wiki}

    # ---- 3. sanidade de era: online ---------------------------------------
    print("\n[3/6] sanidade de era (Xbox Live so a partir de nov/2002)...")
    demoted = 0
    for gid, e in tags.items():
        m = meta[gid]
        if not e["multiplayerOnline"]:
            continue
        wt, year = m["wt"], m["year"]
        ok = bool(STRICT_ONLINE.search(wt))
        if year is not None and year <= 2001:
            ok = False
        elif year == 2002:
            ok = (gid in LIVE_2002) or bool(re.search(r"xbox\s*live", wt, re.I))
        if ok:
            continue
        demoted += 1
        e["multiplayerOnline"] = False
        e["coopOnline"] = False
        # na geracao do sofa, multiplayer sem prova de online = LOCAL
        e["multiplayerLocal"] = True
        if e["maxPlayersOnline"] and not e["maxPlayersLocal"]:
            n = e["maxPlayersOnline"]
            e["maxPlayersLocal"] = min(n, MAX_LOCAL) if SPLITSCREEN_HINT.search(wt) else 0
        e["maxPlayersOnline"] = 0
        if e["confidence"] == "high":
            e["confidence"] = "medium"
    print("      rebaixados de online -> local: %d" % demoted)

    # ---- 4. priors por genero ---------------------------------------------
    print("\n[4/6] priors por genero (sem wiki ou confidence low)...")
    n_prior = 0
    for gid, e in tags.items():
        m = meta[gid]
        if gid in NOWIKI_GENRE:
            spec = NOWIKI_GENRE[gid]
            kind, _, n = spec.partition(":")
            apply_prior(e, kind, int(n or 0))
            n_prior += 1
            continue
        if not m["wt"] or e["confidence"] == "low":
            kind, n = genre_prior(m["genre"], m["title"])
            if kind == "single" and (e["coop"] or e["versus"]) and m["wt"]:
                # ha texto sugerindo multiplayer: mantem, so marca como fraco
                e["confidence"] = "low"
                e["source"] = "genre-prior"
                n_prior += 1
                continue
            apply_prior(e, kind, n)
            n_prior += 1
    print("      priors aplicados: %d" % n_prior)

    # ---- 5. System Link (prioridade sobre a heuristica de texto) ----------
    print("\n[5/6] aplicando System Link...")
    hit, miss = 0, []
    syslink_ids, pc1_ids = set(), set()
    for gid, e in tags.items():
        m = meta[gid]
        rec = None
        for k in (m["wiki"], m["title"]):
            if k and norm_key(k) in syslink:
                rec = syslink[norm_key(k)]
                break
        if not rec:
            continue
        hit += 1
        syslink_ids.add(gid)
        e["multiplayerLocal"] = True
        if rec["per_console"] >= 2:
            e["maxPlayersLocal"] = min(rec["per_console"], MAX_LOCAL)
        elif rec["per_console"] == 1 and e["maxPlayersLocal"] < 2:
            pc1_ids.add(gid)  # sem split-screen conhecido: nao inventa numero
        if rec["total"] >= 2:
            e["maxPlayersOnline"] = max(e["maxPlayersOnline"], rec["total"])
            e["maxPlayers"] = max(e["maxPlayers"], rec["total"])
        if rec["coop"] >= 2 and "no co-op" not in rec["notes"].lower():
            e["coop"] = True
            e["coopLocal"] = True
        if "no co-op" in rec["notes"].lower():
            e["coop"] = e["coopLocal"] = e["coopOnline"] = False
        if rec["versus"] >= 2 or not e["coop"]:
            e["versus"] = True
            e["versusLocal"] = True
        if e["source"].startswith("genre-prior"):
            e["source"] = "systemlink"
        elif "systemlink" not in e["source"]:
            e["source"] = e["source"] + "+systemlink"
        e["confidence"] = "high" if e["confidence"] != "high" else "high"
    print("      jogos casados com a lista System Link: %d" % hit)
    game_keys = set()
    for m in meta.values():
        for k in (m["wiki"], m["title"]):
            if k:
                game_keys.add(norm_key(k))
    for rec in syslink.values():
        if norm_key(rec["article"] or "") not in game_keys and \
           norm_key(rec["display"]) not in game_keys:
            miss.append(rec["display"])
    print("      linhas da lista System Link sem jogo correspondente: %d %s"
          % (len(set(miss)), sorted(set(miss))[:8]))

    # ---- 6. correcoes manuais (ultima palavra) ----------------------------
    print("\n[6/6] correcoes manuais...")
    n_manual, unknown = 0, []
    for gid, over in MANUAL.items():
        if gid not in tags:
            unknown.append(gid)
            continue
        img = tags[gid].get("image")
        e = dict(over)
        e["image"] = img
        # nao perde o numero de rede vindo da lista System Link
        if gid in syslink_ids and not e["maxPlayersOnline"]:
            rec = None
            for k in (meta[gid]["wiki"], meta[gid]["title"]):
                if k and norm_key(k) in syslink:
                    rec = syslink[norm_key(k)]
                    break
            if rec and rec["total"] >= 2:
                e["maxPlayersOnline"] = rec["total"]
        e["maxPlayers"] = max(e["maxPlayers"], e["maxPlayersLocal"], e["maxPlayersOnline"])
        tags[gid] = e
        n_manual += 1
    print("      correcoes manuais aplicadas: %d" % n_manual)
    if unknown:
        print("      !! ids do dicionario MANUAL inexistentes em xbox.json: %s" % unknown)

    # ---- normalizacao / validacao -----------------------------------------
    print("\n[valida] coerencia logica...")
    fix_counter = Counter()
    for gid, e in tags.items():
        allow_net = gid in syslink_ids or e["source"] == "manual"
        fixes = normalize(e, allow_net_without_online=allow_net,
                          no_local_floor=(gid in pc1_ids))
        for f in fixes:
            fix_counter[f] += 1
        # ordem estavel das chaves
        tags[gid] = {
            "image": e.get("image"),
            "singlePlayer": e["singlePlayer"],
            "multiplayerLocal": e["multiplayerLocal"],
            "multiplayerOnline": e["multiplayerOnline"],
            "coop": e["coop"], "coopLocal": e["coopLocal"], "coopOnline": e["coopOnline"],
            "versus": e["versus"], "versusLocal": e["versusLocal"],
            "maxPlayersLocal": e["maxPlayersLocal"],
            "maxPlayersOnline": e["maxPlayersOnline"],
            "maxPlayers": e["maxPlayers"],
            "source": e["source"], "confidence": e["confidence"],
        }
    for k, v in fix_counter.most_common():
        print("      corrigido %-32s %d" % (k, v))

    # ---- gravacao ----------------------------------------------------------
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(tags, f, ensure_ascii=False, indent=1, sort_keys=True)
    print("\ngravado data/tags-xbox.json (%d entradas, %.1f KB)"
          % (len(tags), os.path.getsize(OUT_PATH) / 1024))

    # ---- relatorio ---------------------------------------------------------
    report(games, tags, meta, syslink_ids, n_manual)


def report(games, tags, meta, syslink_ids, n_manual):
    print("\n" + "=" * 72)
    print("RELATORIO")
    print("=" * 72)
    ids = [g["id"] for g in games]
    missing = [i for i in ids if i not in tags]
    print("(a) entradas: %d / %d ids   faltando: %d" % (len(tags), len(ids), len(missing)))
    if missing:
        print("    FALTANDO:", missing[:20])

    with_img = sum(1 for e in tags.values() if e["image"])
    print("(c) com capa: %d (%.1f%%)  sem capa: %d"
          % (with_img, 100.0 * with_img / len(tags), len(tags) - with_img))

    flags = ["singlePlayer", "multiplayerLocal", "multiplayerOnline", "coop",
             "coopLocal", "coopOnline", "versus", "versusLocal"]
    print("\ncontagem por tag:")
    for k in flags:
        n = sum(1 for e in tags.values() if e[k])
        print("   %-20s %4d  (%.1f%%)" % (k, n, 100.0 * n / len(tags)))

    print("\nconfidence: %s" % dict(Counter(e["confidence"] for e in tags.values())))
    print("source    : %s" % dict(Counter(e["source"] for e in tags.values())))
    print("jogos na lista System Link: %d | correcoes manuais: %d"
          % (len(syslink_ids), n_manual))

    print("\nmaxPlayersLocal : %s" % sorted(Counter(
        e["maxPlayersLocal"] for e in tags.values()).items()))
    print("maxPlayersOnline: %s" % sorted(Counter(
        e["maxPlayersOnline"] for e in tags.values()).items()))

    # (d) validador logico
    bad = []
    for gid, e in tags.items():
        if not e["multiplayerLocal"] and not e["multiplayerOnline"]:
            if any(e[k] for k in ("coop", "versus", "coopLocal", "coopOnline", "versusLocal")):
                bad.append((gid, "flags de mp sem multiplayer"))
            if e["maxPlayersLocal"] or e["maxPlayersOnline"] or e["maxPlayers"]:
                bad.append((gid, "contadores != 0 sem multiplayer"))
        if e["coopLocal"] and not e["multiplayerLocal"]:
            bad.append((gid, "coopLocal sem multiplayerLocal"))
        if e["coopOnline"] and not e["multiplayerOnline"]:
            bad.append((gid, "coopOnline sem multiplayerOnline"))
        if e["versusLocal"] and not e["multiplayerLocal"]:
            bad.append((gid, "versusLocal sem multiplayerLocal"))
        if e["coop"] and not (e["coopLocal"] or e["coopOnline"]):
            bad.append((gid, "coop sem escopo"))
        if e["maxPlayersLocal"] > MAX_LOCAL:
            bad.append((gid, "maxPlayersLocal > 4"))
        if e["maxPlayers"] < max(e["maxPlayersLocal"], e["maxPlayersOnline"]):
            bad.append((gid, "maxPlayers menor que o maximo"))
        if e["image"] is not None and not str(e["image"]).startswith("http"):
            bad.append((gid, "image nao e URL"))
        if not e["source"] or not e["confidence"]:
            bad.append((gid, "sem source/confidence"))
    print("\n(d) incoerencias restantes: %d" % len(bad))
    for b in bad[:15]:
        print("    ", b)

    # (e) sanidade de era
    print("\n(e) multiplayerOnline por ano:")
    per_year = defaultdict(lambda: [0, 0])
    for g in games:
        e = tags[g["id"]]
        y = g.get("year")
        per_year[y][0] += 1
        if e["multiplayerOnline"]:
            per_year[y][1] += 1
    for y in sorted(per_year, key=lambda x: (x is None, x)):
        tot, onl = per_year[y]
        print("    %s: %3d jogos, %3d online (%.0f%%)"
              % (y, tot, onl, 100.0 * onl / tot if tot else 0))
    pre = [g["id"] for g in games
           if (g.get("year") or 9999) <= 2002 and tags[g["id"]]["multiplayerOnline"]]
    print("    2001-2002 com online: %d -> %s" % (len(pre), pre))

    # (f) spot-check
    print("\n(f) spot-check:")
    spot = ["xbox-halo-combat-evolved", "xbox-halo-2", "xbox-fable",
            "xbox-star-wars-knights-of-the-old-republic", "xbox-timesplitters-2",
            "xbox-fuzion-frenzy", "xbox-project-gotham-racing-2", "xbox-ninja-gaiden",
            "xbox-baldur-s-gate-dark-alliance", "xbox-soulcalibur-ii",
            "xbox-the-elder-scrolls-iii-morrowind", "xbox-crimson-skies-high-road-to-revenge",
            "xbox-doom-3", "xbox-half-life-2", "xbox-conker-live-and-reloaded"]
    for gid in spot:
        e = tags.get(gid)
        if not e:
            print("    %-45s AUSENTE" % gid)
            continue
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
        print("    %-45s %-32s net=%-3s img=%s  %s/%s"
              % (gid, " ".join(lab), e["maxPlayersOnline"] or "-",
                 "sim" if e["image"] else "NAO", e["source"], e["confidence"]))


if __name__ == "__main__":
    main()
