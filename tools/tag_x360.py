#!/usr/bin/env python3
"""Gera data/tags-x360.json: modos de jogo + URL de capa para TODOS os jogos de x360.json.

Pipeline (idempotente, tudo via cache em disco de wikilib):
  1. wikitext em massa dos ~2004 jogos com artigo -> taglib.build_tags
  2. capa: pageimages (wikilib.batch_images) + fallback pelo parametro image= da
     Infobox video game resolvido por action=query&prop=imageinfo (pageimages IGNORA
     arquivos nao-livres, e box art de jogo e' fair-use: sozinho ele cobre ~2%)
  3. overlay autoritativo de "List of Xbox 360 System Link games" (multiplayer local)
  4. priors por genero para jogos sem artigo / confidence low
  5. correcoes MANUAIS (dicionario MANUAL abaixo) - ultima palavra
  6. validador de coerencia logica + estatisticas + spot-check

Uso:  python3 tools/tag_x360.py
"""
import json
import os
import re
import sys
import unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import wikilib as w   # noqa: E402
import taglib as t    # noqa: E402

SRC = os.path.join(ROOT, "data", "x360.json")
OUT = os.path.join(ROOT, "data", "tags-x360.json")
SYSLINK_PAGE = "List of Xbox 360 System Link games"


# --------------------------------------------------------------------------
# 1) correcoes manuais (aplicadas DEPOIS de tudo; source=manual confidence=high)
# --------------------------------------------------------------------------

def M(loc=0, onl=0, cl=0, co=0, vl=0, vo=0, sp=1, keep_local=0):
    """loc/onl = max de jogadores local(mesma casa)/online; cl/co = co-op local/online;
    vl/vo = versus local/online. keep_local=1 preserva o que o System Link apurou."""
    d = {
        "singlePlayer": bool(sp),
        "multiplayerLocal": bool(loc or cl or vl),
        "multiplayerOnline": bool(onl or co or vo),
        "coop": bool(cl or co),
        "coopLocal": bool(cl),
        "coopOnline": bool(co),
        "versus": bool(vl or vo),
        "versusLocal": bool(vl),
        "maxPlayersLocal": int(loc),
        "maxPlayersOnline": int(onl),
        "maxPlayers": max(int(loc), int(onl)),
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
    if keep_local:
        d["_keep_local"] = True
    return d


MANUAL = {
    # ---- Halo ----
    "x360-halo-3": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-halo-3-odst": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-halo-reach": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-halo-4": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-halo-combat-evolved-anniversary": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-halo-wars": M(2, 6, cl=1, co=1, vl=1, vo=1),
    "x360-halo-spartan-assault": M(0, 2, co=1),
    # ---- Gears of War ----
    "x360-gears-of-war": M(2, 8, cl=1, co=1, vl=1, vo=1),
    "x360-gears-of-war-2": M(2, 10, cl=1, co=1, vl=1, vo=1),
    "x360-gears-of-war-3": M(2, 10, cl=1, co=1, vl=1, vo=1),
    "x360-gears-of-war-judgment": M(2, 10, cl=1, co=1, vl=1, vo=1),
    # ---- Call of Duty ----
    "x360-call-of-duty-2": M(onl=8, vo=1, keep_local=1),
    "x360-call-of-duty-3": M(onl=24, vo=1, keep_local=1),
    "x360-call-of-duty-classic": M(),
    "x360-call-of-duty-4-modern-warfare": M(2, 18, vl=1, vo=1),
    "x360-call-of-duty-world-at-war": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-modern-warfare-2": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-black-ops": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-modern-warfare-3": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-black-ops-ii": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-ghosts": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-advanced-warfare": M(2, 18, cl=1, co=1, vl=1, vo=1),
    "x360-call-of-duty-black-ops-iii": M(2, 12, cl=1, co=1, vl=1, vo=1),
    # ---- Forza ----
    "x360-forza-motorsport-2": M(2, 8, vl=1, vo=1),
    "x360-forza-motorsport-3": M(2, 8, vl=1, vo=1),
    "x360-forza-motorsport-4": M(2, 8, vl=1, vo=1),
    "x360-forza-horizon": M(0, 8, vo=1),
    "x360-forza-horizon-2": M(0, 8, vo=1),
    # ---- FIFA / PES ----
    "x360-fifa-06-road-to-fifa-world-cup": M(4, 2, cl=1, vl=1, vo=1),
    "x360-fifa-07": M(4, 2, cl=1, vl=1, vo=1),
    "x360-fifa-08": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-09": M(4, 20, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-10": M(4, 20, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-11": M(4, 20, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-12": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-13": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-14": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-15": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-16": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-17": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-18-legacy-edition": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-fifa-19-legacy-edition": M(4, 22, cl=1, co=1, vl=1, vo=1),
    "x360-2006-fifa-world-cup": M(4, 2, cl=1, vl=1, vo=1),
    "x360-2010-fifa-world-cup-south-africa": M(4, 4, cl=1, vl=1, vo=1),
    "x360-2014-fifa-world-cup-brazil": M(4, 4, cl=1, vl=1, vo=1),
    "x360-fifa-street": M(4, 4, cl=1, vl=1, vo=1),
    "x360-fifa-street-3": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-6": M(4, 2, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2008": M(4, 2, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2009": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2010": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2011": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2012": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2013": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2014": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2015": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2016": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2017": M(4, 4, cl=1, vl=1, vo=1),
    "x360-pro-evolution-soccer-2018": M(4, 4, cl=1, vl=1, vo=1),
    # ---- Valve / co-op classicos ----
    "x360-left-4-dead": M(2, 8, cl=1, co=1, vl=1, vo=1),
    "x360-left-4-dead-2": M(2, 8, cl=1, co=1, vl=1, vo=1),
    "x360-portal-2": M(2, 2, cl=1, co=1),
    "x360-portal-still-alive": M(),
    "x360-the-orange-box": M(0, 16, vo=1),
    "x360-counter-strike-global-offensive": M(0, 10, vo=1),
    # ---- Borderlands / Minecraft / sandbox ----
    "x360-borderlands": M(2, 4, cl=1, co=1, vl=1, vo=1),
    "x360-borderlands-2": M(2, 4, cl=1, co=1, vl=1, vo=1),
    "x360-borderlands-the-pre-sequel": M(2, 4, cl=1, co=1, vl=1, vo=1),
    "x360-minecraft-xbox-360-edition": M(4, 8, cl=1, co=1, vl=1, vo=1),
    "x360-minecraft-story-mode": M(),
    "x360-minecraft-story-mode-season-two": M(),
    "x360-terraria-xbox-360-edition": M(4, 8, cl=1, co=1, vl=1, vo=1),
    "x360-state-of-decay": M(),
    # ---- Rock Band / Guitar Hero / musica ----
    "x360-rock-band": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-2": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-3": M(7, 4, cl=1, co=1, vl=1, vo=1),
    "x360-the-beatles-rock-band": M(6, 4, cl=1, co=1, vl=1, vo=1),
    "x360-green-day-rock-band": M(6, 4, cl=1, co=1, vl=1, vo=1),
    "x360-lego-rock-band": M(4, 0, cl=1, vl=1),
    "x360-rock-band-blitz": M(),
    "x360-ac-dc-live-rock-band-track-pack": M(4, 0, cl=1, vl=1),
    "x360-rock-band-track-pack-volume-2": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-classic-rock-track-pack": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-country-track-pack": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-country-track-pack-2": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-rock-band-metal-track-pack": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-ii": M(2, 0, cl=1, vl=1),
    "x360-guitar-hero-iii-legends-of-rock": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-aerosmith": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-world-tour": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-metallica": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-smash-hits": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-5": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-band-hero": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-van-halen": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-warriors-of-rock": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-guitar-hero-live": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-dj-hero": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-dj-hero-2": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-lips": M(2, 0, cl=1, vl=1),
    "x360-lips-number-one-hits": M(2, 0, cl=1, vl=1),
    "x360-lips-i-love-the-80-s": M(2, 0, cl=1, vl=1),
    "x360-lips-party-classics": M(2, 0, cl=1, vl=1),
    "x360-lips-canta-en-espanol": M(2, 0, cl=1, vl=1),
    "x360-lips-deutsche-partyknaller": M(2, 0, cl=1, vl=1),
    "x360-michael-jackson-the-experience": M(2, 0, cl=1, vl=1),
    "x360-the-black-eyed-peas-experience": M(2, 0, cl=1, vl=1),
    "x360-def-jam-rapstar": M(4, 0, cl=1, vl=1),
    # ---- Kinect / dance / party ----
    "x360-dance-central": M(2, 0, vl=1),
    "x360-dance-central-2": M(2, 0, cl=1, vl=1),
    "x360-dance-central-3": M(2, 0, cl=1, vl=1),
    "x360-kinect-adventures": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-kinect-sports": M(4, 2, cl=1, vl=1, vo=1),
    "x360-kinect-sports-season-two": M(4, 2, cl=1, vl=1, vo=1),
    "x360-kinect-sports-ultimate-collection": M(4, 2, cl=1, vl=1, vo=1),
    "x360-kinect-joy-ride": M(2, 8, vl=1, vo=1),
    "x360-kinect-star-wars": M(2, 0, cl=1, vl=1),
    "x360-kinectimals": M(),
    "x360-kinectimals-now-with-bears": M(),
    "x360-kinect-disneyland-adventures": M(2, 0, cl=1),
    "x360-kinect-rush-a-disney-pixar-adventure": M(2, 0, cl=1),
    "x360-kinect-party": M(4, 0, cl=1),
    "x360-double-fine-happy-action-theater": M(4, 0, cl=1),
    "x360-fruit-ninja-kinect": M(2, 0, cl=1, vl=1),
    "x360-wreckateer": M(2, 0, vl=1),
    "x360-the-gunstringer": M(2, 0, cl=1),
    "x360-child-of-eden": M(),
    "x360-sonic-free-riders": M(2, 0, vl=1),
    "x360-zumba-fitness": M(2, 0, cl=1),
    "x360-zumba-fitness-rush": M(2, 0, cl=1),
    "x360-zumba-fitness-core": M(2, 0, cl=1),
    "x360-zumba-fitness-world-party": M(2, 0, cl=1),
    "x360-just-dance-3": M(4, 0, cl=1, vl=1),
    "x360-just-dance-4": M(4, 0, cl=1, vl=1),
    "x360-just-dance-2014": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-2015": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-2016": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-2017": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-2018": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-2019": M(4, 4, cl=1, vl=1, vo=1),
    "x360-just-dance-greatest-hits": M(4, 0, cl=1, vl=1),
    "x360-just-dance-kids-2": M(4, 0, cl=1, vl=1),
    "x360-just-dance-kids-2014": M(4, 0, cl=1, vl=1),
    "x360-just-dance-disney-party": M(4, 0, cl=1, vl=1),
    "x360-just-dance-disney-party-2": M(4, 0, cl=1, vl=1),
    "x360-the-hip-hop-dance-experience": M(4, 0, cl=1, vl=1),
    "x360-game-party-in-motion": M(4, 0, vl=1),
    "x360-wipeout-2": M(4, 0, vl=1),
    "x360-wipeout-3": M(4, 0, vl=1),
    "x360-wipeout-in-the-zone": M(4, 0, vl=1),
    "x360-wipeout-create-and-crash": M(4, 0, vl=1),
    "x360-carnival-games-monkey-see-monkey-do": M(2, 0, vl=1),
    "x360-raving-rabbids-alive-and-kicking": M(4, 0, cl=1, vl=1),
    "x360-rayman-raving-rabbids": M(4, 0, vl=1),
    # ---- Luta ----
    "x360-street-fighter-iv": M(2, 2, vl=1, vo=1),
    "x360-super-street-fighter-iv": M(2, 2, vl=1, vo=1),
    "x360-super-street-fighter-iv-arcade-edition": M(2, 2, vl=1, vo=1),
    "x360-street-fighter-x-tekken": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-street-fighter-ii-hyper-fighting": M(2, 2, vl=1, vo=1),
    "x360-street-fighter-iii-3rd-strike-online-edition": M(2, 2, vl=1, vo=1),
    "x360-super-street-fighter-ii-turbo-hd-remix": M(2, 2, vl=1, vo=1),
    "x360-tekken-6": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-tekken-tag-tournament-2": M(2, 4, vl=1, vo=1),
    "x360-mortal-kombat": M(2, 4, vl=1, vo=1),
    "x360-mortal-kombat-vs-dc-universe": M(2, 2, vl=1, vo=1),
    "x360-mortal-kombat-arcade-kollection": M(2, 2, vl=1, vo=1),
    "x360-dead-or-alive-4": M(2, 4, vl=1, vo=1),
    "x360-dead-or-alive-5": M(2, 4, vl=1, vo=1),
    "x360-dead-or-alive-5-ultimate": M(2, 4, vl=1, vo=1),
    "x360-dead-or-alive-5-last-round": M(2, 4, vl=1, vo=1),
    "x360-soulcalibur": M(2, 2, vl=1, vo=1),
    "x360-soulcalibur-ii-hd-online": M(2, 2, vl=1, vo=1),
    "x360-soulcalibur-iv": M(2, 2, vl=1, vo=1),
    "x360-soulcalibur-v": M(2, 2, vl=1, vo=1),
    "x360-blazblue-calamity-trigger": M(2, 2, vl=1, vo=1),
    "x360-blazblue-continuum-shift": M(2, 2, vl=1, vo=1),
    "x360-blazblue-continuum-shift-extend": M(2, 2, vl=1, vo=1),
    "x360-the-king-of-fighters-xiii": M(2, 2, vl=1, vo=1),
    "x360-the-king-of-fighters-98-ultimate-match": M(2, 2, vl=1, vo=1),
    "x360-the-king-of-fighters-2002-unlimited-match": M(2, 2, vl=1, vo=1),
    "x360-guilty-gear-xx-accent-core-plus": M(2, 2, vl=1, vo=1),
    "x360-marvel-vs-capcom-2-new-age-of-heroes": M(2, 2, vl=1, vo=1),
    "x360-marvel-vs-capcom-3-fate-of-two-worlds": M(2, 2, vl=1, vo=1),
    "x360-marvel-vs-capcom-origins": M(2, 2, vl=1, vo=1),
    "x360-virtua-fighter-5-online": M(2, 2, vl=1, vo=1),
    "x360-virtua-fighter-5-final-showdown": M(2, 2, vl=1, vo=1),
    "x360-virtua-fighter-2": M(2, 2, vl=1, vo=1),
    "x360-sonic-the-fighters": M(2, 2, vl=1, vo=1),
    "x360-scott-pilgrim-vs-the-world-the-game": M(4, 0, cl=1, vl=1),
    "x360-castle-crashers": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-naruto-rise-of-a-ninja": M(2, 2, vl=1, vo=1),
    "x360-naruto-the-broken-bond": M(2, 2, cl=1, vl=1, vo=1),
    "x360-naruto-shippuden-ultimate-ninja-storm-2": M(2, 2, vl=1, vo=1),
    "x360-naruto-shippuden-ultimate-ninja-storm-3": M(2, 2, vl=1, vo=1),
    "x360-naruto-shippuden-ultimate-ninja-storm-3-full-burst": M(2, 2, vl=1, vo=1),
    "x360-naruto-shippuden-ultimate-ninja-storm-generations": M(2, 2, vl=1, vo=1),
    "x360-naruto-shippuden-ultimate-ninja-storm-revolution": M(2, 2, vl=1, vo=1),
    "x360-dragon-ball-raging-blast": M(2, 2, vl=1, vo=1),
    "x360-dragon-ball-raging-blast-2": M(2, 2, vl=1, vo=1),
    "x360-dragon-ball-xenoverse": M(2, 6, cl=1, co=1, vl=1, vo=1),
    "x360-dragon-ball-z-battle-of-z": M(2, 8, cl=1, co=1, vl=1, vo=1),
    "x360-dragon-ball-z-burst-limit": M(2, 2, vl=1, vo=1),
    "x360-dragon-ball-z-ultimate-tenkaichi": M(2, 2, vl=1, vo=1),
    "x360-dragon-ball-z-budokai-hd-collection": M(2, 2, vl=1, vo=1),
    "x360-fight-night-round-3": M(2, 2, vl=1, vo=1),
    "x360-fight-night-round-4": M(2, 2, vl=1, vo=1),
    "x360-fight-night-champion": M(2, 2, vl=1, vo=1),
    "x360-ufc-2009-undisputed": M(2, 2, vl=1, vo=1),
    "x360-ufc-undisputed-2010": M(2, 2, vl=1, vo=1),
    "x360-ufc-undisputed-3": M(2, 2, vl=1, vo=1),
    "x360-wwe-smackdown-vs-raw-2007": M(6, 6, vl=1, vo=1),
    "x360-wwe-smackdown-vs-raw-2008": M(6, 6, vl=1, vo=1),
    "x360-wwe-smackdown-vs-raw-2009": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-smackdown-vs-raw-2010": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-smackdown-vs-raw-2011": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-12": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-13": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-2k14": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-2k15": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-2k16": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-2k17": M(6, 6, cl=1, co=1, vl=1, vo=1),
    "x360-wwe-all-stars": M(2, 2, vl=1, vo=1),
    "x360-wwe-legends-of-wrestlemania": M(2, 2, vl=1, vo=1),
    # ---- Trials / arcade de habilidade ----
    "x360-trials-hd": M(),
    "x360-trials-evolution": M(4, 4, vl=1, vo=1),
    "x360-trials-fusion": M(4, 4, vl=1, vo=1),
    # ---- Mundo aberto / RPG ----
    "x360-the-elder-scrolls-v-skyrim": M(),
    "x360-fallout-3": M(),
    "x360-fallout-new-vegas": M(),
    "x360-fallout-3-game-add-on-pack-broken-steel-and-point-lookout": M(),
    "x360-fallout-3-game-add-on-pack-the-pitt-and-operation-anchorage": M(),
    "x360-grand-theft-auto-iv": M(0, 16, co=1, vo=1),
    "x360-grand-theft-auto-v": M(0, 16, co=1, vo=1),
    "x360-grand-theft-auto-episodes-from-liberty-city": M(0, 16, co=1, vo=1),
    "x360-grand-theft-auto-online": M(0, 16, co=1, vo=1),
    "x360-grand-theft-auto-san-andreas": M(),
    "x360-red-dead-redemption": M(0, 16, co=1, vo=1),
    "x360-red-dead-redemption-undead-nightmare": M(0, 16, co=1, vo=1),
    "x360-max-payne-3": M(0, 16, vo=1),
    "x360-saints-row": M(0, 12, co=1, vo=1),
    "x360-saints-row-2": M(0, 12, co=1, vo=1),
    "x360-saints-row-the-third": M(0, 2, co=1),
    "x360-saints-row-iv": M(0, 2, co=1),
    "x360-saints-row-gat-out-of-hell": M(0, 2, co=1),
    "x360-sleeping-dogs": M(),
    "x360-mass-effect": M(),
    "x360-mass-effect-2": M(),
    "x360-mass-effect-3": M(0, 4, co=1),
    "x360-dark-souls": M(0, 4, co=1, vo=1),
    "x360-dark-souls-ii": M(0, 6, co=1, vo=1),
    "x360-torchlight": M(),
    "x360-dungeon-siege-iii": M(2, 4, cl=1, co=1),
    "x360-sacred-3": M(2, 4, cl=1, co=1),
    "x360-sacred-citadel": M(3, 3, cl=1, co=1),
    "x360-marvel-ultimate-alliance": M(4, 4, cl=1, co=1),
    "x360-marvel-ultimate-alliance-2": M(4, 4, cl=1, co=1),
    "x360-fable-ii": M(2, 2, cl=1, co=1),
    "x360-fable-iii": M(2, 2, cl=1, co=1),
    "x360-fable-anniversary": M(),
    "x360-fable-the-journey": M(),
    "x360-fable-heroes": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-catherine": M(2, 0, vl=1),
    # ---- Tiro ----
    "x360-battlefield-2-modern-combat": M(2, 24, vl=1, vo=1),
    "x360-battlefield-bad-company": M(0, 24, vo=1),
    "x360-battlefield-bad-company-2": M(0, 24, vo=1),
    "x360-battlefield-1943": M(0, 24, vo=1),
    "x360-battlefield-3": M(0, 24, co=1, vo=1),
    "x360-battlefield-4": M(0, 24, vo=1),
    "x360-battlefield-hardline": M(0, 24, vo=1),
    "x360-bioshock": M(),
    "x360-bioshock-2": M(0, 10, vo=1),
    "x360-bioshock-infinite": M(),
    "x360-crysis": M(),
    "x360-crysis-2": M(0, 12, vo=1),
    "x360-crysis-3": M(0, 12, vo=1),
    "x360-bulletstorm": M(0, 4, co=1),
    "x360-medal-of-honor": M(0, 24, vo=1),
    "x360-medal-of-honor-airborne": M(0, 12, vo=1),
    "x360-medal-of-honor-warfighter": M(0, 20, vo=1),
    "x360-far-cry-2": M(0, 16, vo=1),
    "x360-far-cry-3": M(2, 14, cl=1, co=1, vo=1),
    "x360-far-cry-3-blood-dragon": M(),
    "x360-far-cry-4": M(0, 10, co=1, vo=1),
    "x360-far-cry-instincts-predator": M(0, 16, vo=1),
    "x360-far-cry-classic": M(),
    "x360-perfect-dark": M(4, 8, cl=1, co=1, vl=1, vo=1),
    "x360-perfect-dark-zero": M(4, 32, cl=1, co=1, vl=1, vo=1),
    "x360-unreal-tournament-3": M(2, 16, cl=1, co=1, vl=1, vo=1),
    "x360-quake-4": M(0, 16, vo=1),
    "x360-quake-arena-arcade": M(0, 16, vo=1),
    "x360-enemy-territory-quake-wars": M(0, 16, vo=1),
    "x360-doom": M(0, 4, co=1, vo=1),
    "x360-doom-ii-hell-on-earth": M(0, 4, co=1, vo=1),
    "x360-doom-3-bfg-edition": M(0, 4, co=1, vo=1),
    "x360-duke-nukem-3d": M(0, 8, co=1, vo=1),
    "x360-duke-nukem-forever": M(0, 8, vo=1),
    "x360-wolfenstein": M(0, 12, vo=1),
    "x360-wolfenstein-3d": M(),
    "x360-wolfenstein-the-new-order": M(),
    "x360-gotham-city-impostors": M(0, 12, vo=1),
    "x360-serious-sam-hd-the-first-encounter": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-serious-sam-hd-the-second-encounter": M(4, 16, cl=1, co=1, vl=1, vo=1),
    "x360-serious-sam-3-bfe": M(0, 16, co=1, vo=1),
    "x360-earth-defense-force-2017": M(2, 0, cl=1),
    "x360-earth-defense-force-2025": M(2, 4, cl=1, co=1),
    "x360-earth-defense-force-insect-armageddon": M(2, 6, cl=1, co=1, vo=1),
    "x360-lost-planet-extreme-condition": M(0, 16, vo=1),
    "x360-lost-planet-extreme-condition-colonies-edition": M(0, 16, vo=1),
    "x360-lost-planet-2": M(2, 16, cl=1, co=1, vl=1, vo=1),
    "x360-lost-planet-3": M(0, 8, vo=1),
    "x360-syndicate": M(0, 4, co=1),
    "x360-dead-space": M(),
    "x360-dead-space-2": M(0, 8, vo=1),
    "x360-dead-space-3": M(0, 2, co=1),
    "x360-dead-space-ignition": M(),
    "x360-dead-island": M(0, 4, co=1),
    "x360-dead-island-riptide": M(0, 4, co=1),
    "x360-plants-vs-zombies-garden-warfare": M(2, 24, cl=1, co=1, vo=1),
    # ---- Stealth / acao ----
    "x360-tom-clancy-s-splinter-cell-double-agent": M(0, 6, co=1, vo=1),
    "x360-tom-clancy-s-splinter-cell-conviction": M(2, 2, cl=1, co=1),
    "x360-tom-clancy-s-splinter-cell-blacklist": M(0, 4, co=1, vo=1),
    "x360-tom-clancy-s-rainbow-six-vegas": M(2, 16, cl=1, co=1, vl=1, vo=1),
    "x360-tom-clancy-s-rainbow-six-vegas-2": M(2, 16, cl=1, co=1, vl=1, vo=1),
    "x360-army-of-two": M(2, 2, cl=1, co=1),
    "x360-army-of-two-the-40th-day": M(2, 4, cl=1, co=1, vo=1),
    "x360-army-of-two-the-devil-s-cartel": M(2, 2, cl=1, co=1),
    "x360-assassin-s-creed": M(),
    "x360-assassin-s-creed-ii": M(),
    "x360-assassin-s-creed-brotherhood": M(0, 8, vo=1),
    "x360-assassin-s-creed-revelations": M(0, 8, vo=1),
    "x360-assassin-s-creed-iii": M(0, 8, vo=1),
    "x360-assassin-s-creed-iv-black-flag": M(0, 8, vo=1),
    "x360-assassin-s-creed-rogue": M(),
    "x360-assassin-s-creed-liberation-hd": M(),
    "x360-batman-arkham-asylum": M(),
    "x360-batman-arkham-city": M(),
    "x360-batman-arkham-origins": M(0, 8, vo=1),
    "x360-crackdown": M(0, 2, co=1),
    "x360-crackdown-2": M(0, 16, co=1, vo=1),
    "x360-prototype": M(),
    "x360-prototype-2": M(),
    "x360-mirror-s-edge": M(),
    "x360-tomb-raider": M(0, 8, vo=1),
    "x360-tomb-raider-legend": M(),
    "x360-tomb-raider-anniversary": M(),
    "x360-tomb-raider-underworld": M(),
    "x360-dead-rising": M(),
    "x360-dead-rising-2": M(0, 4, co=1, vo=1),
    "x360-dead-rising-2-case-zero": M(),
    "x360-dead-rising-2-case-west": M(0, 2, co=1),
    "x360-dead-rising-2-off-the-record": M(0, 2, co=1),
    "x360-resident-evil-5": M(2, 4, cl=1, co=1, vl=1, vo=1),
    "x360-resident-evil-6": M(2, 6, cl=1, co=1, vl=1, vo=1),
    "x360-resident-evil-operation-raccoon-city": M(0, 8, co=1, vo=1),
    "x360-resident-evil-revelations": M(0, 2, co=1),
    "x360-resident-evil-revelations-2": M(2, 2, cl=1, co=1),
    "x360-resident-evil-4": M(),
    "x360-resident-evil-code-veronica-x": M(),
    "x360-resident-evil-hd-remaster": M(),
    "x360-resident-evil-zero-hd-remaster": M(),
    "x360-castlevania-harmony-of-despair": M(6, 6, cl=1, co=1),
    "x360-castlevania-lords-of-shadow": M(),
    "x360-castlevania-lords-of-shadow-2": M(),
    "x360-star-wars-the-force-unleashed": M(2, 0, vl=1),
    "x360-star-wars-the-force-unleashed-ii": M(),
    "x360-star-wars-the-clone-wars-republic-heroes": M(2, 0, cl=1),
    "x360-transformers-war-for-cybertron": M(0, 10, co=1, vo=1),
    "x360-transformers-fall-of-cybertron": M(0, 12, co=1, vo=1),
    "x360-transformers-rise-of-the-dark-spark": M(0, 4, co=1),
    "x360-transformers-devastation": M(),
    "x360-spider-man-friend-or-foe": M(2, 0, cl=1),
    "x360-marvel-super-hero-squad-the-infinity-gauntlet": M(2, 0, cl=1),
    "x360-x-men-origins-wolverine": M(),
    "x360-deadpool": M(),
    "x360-teenage-mutant-ninja-turtles-turtles-in-time-re-shelled": M(4, 4, cl=1, co=1),
    "x360-teenage-mutant-ninja-turtles-out-of-the-shadows": M(0, 4, co=1),
    "x360-dungeons-and-dragons-chronicles-of-mystara-shadow-over-mystara-and-tower-of-doom": M(4, 4, cl=1, co=1),
    "x360-streets-of-rage-2": M(2, 2, cl=1, co=1),
    "x360-golden-axe": M(2, 2, cl=1, co=1),
    "x360-double-dragon": M(2, 2, cl=1, co=1),
    "x360-double-dragon-neon": M(2, 0, cl=1),
    "x360-contra": M(2, 2, cl=1, co=1),
    "x360-metal-slug-3": M(2, 2, cl=1, co=1),
    "x360-metal-slug-xx": M(2, 2, cl=1, co=1),
    "x360-gauntlet": M(4, 4, cl=1, co=1),
    "x360-alien-hominid-hd": M(2, 0, cl=1),
    # ---- LEGO (co-op local 2P, sem online no 360) ----
    "x360-lego-batman-the-videogame": M(2, 0, cl=1),
    "x360-lego-batman-2-dc-super-heroes": M(2, 0, cl=1),
    "x360-lego-batman-3-beyond-gotham": M(2, 0, cl=1),
    "x360-lego-dimensions": M(2, 0, cl=1),
    "x360-lego-harry-potter-years-1-4": M(2, 0, cl=1),
    "x360-lego-harry-potter-years-5-7": M(2, 0, cl=1),
    "x360-lego-the-hobbit": M(2, 0, cl=1),
    "x360-lego-indiana-jones-the-original-adventures": M(2, 0, cl=1),
    "x360-lego-indiana-jones-2-the-adventure-continues": M(2, 0, cl=1),
    "x360-lego-jurassic-world": M(2, 0, cl=1),
    "x360-lego-the-lord-of-the-rings": M(2, 0, cl=1),
    "x360-lego-marvel-super-heroes": M(2, 0, cl=1),
    "x360-lego-marvel-s-avengers": M(2, 0, cl=1),
    "x360-the-lego-movie-videogame": M(2, 0, cl=1),
    "x360-lego-pirates-of-the-caribbean-the-video-game": M(2, 0, cl=1),
    "x360-lego-star-wars-the-complete-saga": M(2, 0, cl=1),
    "x360-lego-star-wars-ii-the-original-trilogy": M(2, 0, cl=1),
    "x360-lego-star-wars-iii-the-clone-wars": M(2, 0, cl=1),
    "x360-lego-star-wars-the-force-awakens": M(2, 0, cl=1),
    # ---- Plataforma / XBLA ----
    "x360-braid": M(),
    "x360-limbo": M(),
    "x360-super-meat-boy": M(),
    "x360-shadow-complex": M(),
    "x360-splosion-man": M(4, 4, cl=1, co=1),
    "x360-ms-splosion-man": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-n-plus": M(4, 0, cl=1, vl=1),
    "x360-small-arms": M(4, 4, vl=1, vo=1),
    "x360-geometry-wars-retro-evolved": M(),
    "x360-geometry-wars-retro-evolved-2": M(4, 0, cl=1, vl=1),
    "x360-geometry-wars-3-dimensions": M(4, 0, cl=1, vl=1),
    "x360-geometry-wars-3-dimensions-evolved": M(4, 0, cl=1, vl=1),
    "x360-trine-2": M(3, 3, cl=1, co=1),
    "x360-spelunky": M(4, 0, cl=1, vl=1),
    "x360-dungeon-defenders": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-happy-wars": M(0, 30, co=1, vo=1),
    "x360-toy-soldiers": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-toy-soldiers-cold-war": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-renegade-ops": M(2, 4, cl=1, co=1),
    "x360-deadlight": M(),
    "x360-hydro-thunder-hurricane": M(4, 8, vl=1, vo=1),
    "x360-joy-ride-turbo": M(4, 8, vl=1, vo=1),
    "x360-bomberman-live": M(4, 8, vl=1, vo=1),
    "x360-bomberman-live-battlefest": M(4, 8, vl=1, vo=1),
    "x360-bomberman-act-zero": M(2, 8, vl=1, vo=1),
    "x360-hexic-hd": M(),
    "x360-hexic-2": M(4, 0, vl=1),
    "x360-boom-boom-rocket": M(),
    "x360-pac-man-championship-edition": M(),
    "x360-pac-man-championship-edition-dx": M(),
    "x360-rayman-origins": M(4, 0, cl=1),
    "x360-rayman-legends": M(4, 0, cl=1),
    "x360-rayman-3-hd": M(),
    "x360-toy-story-3-the-video-game": M(2, 0, cl=1),
    "x360-shrek-forever-after": M(4, 0, cl=1),
    "x360-kung-fu-panda": M(2, 0, vl=1),
    "x360-viva-pinata": M(),
    "x360-viva-pinata-trouble-in-paradise": M(2, 2, cl=1, co=1),
    "x360-viva-pinata-party-animals": M(4, 4, vl=1, vo=1),
    "x360-banjo-kazooie": M(),
    "x360-banjo-tooie": M(4, 0, vl=1),
    "x360-banjo-kazooie-nuts-and-bolts": M(2, 8, vl=1, vo=1),
    # ---- Sonic ----
    "x360-sonic-the-hedgehog": M(),                      # Sonic 1 (Mega Drive/XBLA)
    "x360-sonic-the-hedgehog-2": M(2, 0, vl=1),          # Sonic the Hedgehog (2006)
    "x360-sonic-the-hedgehog-2-2": M(2, 2, vl=1, vo=1),  # Sonic 2 (Mega Drive/XBLA)
    "x360-sonic-the-hedgehog-3": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-sonic-and-knuckles": M(2, 2, cl=1, co=1, vl=1, vo=1),
    "x360-sonic-cd": M(),
    "x360-sonic-generations": M(),
    "x360-sonic-unleashed": M(),
    "x360-sonic-adventure": M(2, 0, vl=1),
    "x360-sonic-adventure-2": M(2, 0, vl=1),
    "x360-sonic-the-hedgehog-4-episode-i": M(),
    "x360-sonic-the-hedgehog-4-episode-ii": M(2, 2, cl=1, co=1),
    "x360-sonic-and-sega-all-stars-racing": M(4, 8, vl=1, vo=1),
    "x360-sonic-and-all-stars-racing-transformed": M(4, 10, vl=1, vo=1),
    "x360-sonic-s-ultimate-genesis-collection": M(2, 0, cl=1, vl=1),
    "x360-sega-superstars-tennis": M(4, 4, vl=1, vo=1),
    # ---- Corrida ----
    "x360-project-gotham-racing-3": M(2, 8, vl=1, vo=1),
    "x360-project-gotham-racing-4": M(2, 8, vl=1, vo=1),
    "x360-blur": M(4, 20, vl=1, vo=1),
    "x360-split-second": M(2, 8, vl=1, vo=1),
    "x360-burnout-revenge": M(2, 6, vl=1, vo=1),
    "x360-burnout-paradise": M(0, 8, vo=1),
    "x360-midnight-club-los-angeles": M(0, 16, vo=1),
    "x360-need-for-speed-carbon": M(0, 8, vo=1),
    "x360-need-for-speed-prostreet": M(0, 8, vo=1),
    "x360-need-for-speed-undercover": M(0, 8, vo=1),
    "x360-need-for-speed-shift": M(0, 8, vo=1),
    "x360-need-for-speed-shift-2-unleashed": M(0, 12, vo=1),
    "x360-need-for-speed-hot-pursuit": M(0, 8, vo=1),
    "x360-need-for-speed-the-run": M(0, 8, vo=1),
    "x360-need-for-speed-most-wanted-2012": M(0, 8, vo=1),
    "x360-need-for-speed-rivals": M(0, 6, vo=1),
    "x360-dirt": M(0, 8, vo=1),
    "x360-dirt-2": M(0, 8, vo=1),
    "x360-dirt-3": M(2, 8, vl=1, vo=1),
    "x360-dirt-showdown": M(2, 8, vl=1, vo=1),
    "x360-grid-2": M(2, 12, vl=1, vo=1),
    "x360-grid-autosport": M(2, 12, vl=1, vo=1),
    "x360-f1-2010": M(0, 12, vo=1),
    "x360-f1-2011": M(2, 16, vl=1, vo=1),
    "x360-f1-2012": M(2, 16, vl=1, vo=1),
    "x360-f1-2013": M(2, 16, vl=1, vo=1),
    "x360-f1-2014": M(2, 16, vl=1, vo=1),
    # ---- Esportes ----
    "x360-madden-nfl-06": M(4, 2, cl=1, vl=1, vo=1),
    "x360-madden-nfl-07": M(4, 2, cl=1, vl=1, vo=1),
    "x360-madden-nfl-08": M(4, 2, cl=1, vl=1, vo=1),
    "x360-madden-nfl-09": M(4, 2, cl=1, vl=1, vo=1),
    "x360-madden-nfl-10": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-11": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-12": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-13": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-25": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-15": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-16": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-madden-nfl-17": M(4, 6, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k6": M(4, 2, cl=1, vl=1, vo=1),
    "x360-nba-2k7": M(4, 2, cl=1, vl=1, vo=1),
    "x360-nba-2k8": M(4, 2, cl=1, vl=1, vo=1),
    "x360-nba-2k9": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k10": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k11": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k12": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k13": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k14": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k15": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k16": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k17": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-2k18": M(4, 10, cl=1, co=1, vl=1, vo=1),
    "x360-nba-jam": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-nba-jam-on-fire-edition": M(4, 4, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-07": M(4, 2, cl=1, vl=1, vo=1),
    "x360-nhl-08": M(4, 2, cl=1, vl=1, vo=1),
    "x360-nhl-09": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-10": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-11": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-12": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-13": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-14": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-15": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-nhl-legacy-edition": M(4, 12, cl=1, co=1, vl=1, vo=1),
    "x360-skate": M(0, 8, vo=1),
    "x360-skate-2": M(0, 8, vo=1),
    "x360-skate-3": M(0, 6, co=1, vo=1),
    "x360-tony-hawk-s-american-wasteland": M(2, 8, vl=1, vo=1),
    "x360-tony-hawk-s-project-8": M(2, 8, vl=1, vo=1),
    "x360-tony-hawk-s-proving-ground": M(2, 8, vl=1, vo=1),
    "x360-top-spin-2": M(4, 4, cl=1, vl=1, vo=1),
    "x360-top-spin-3": M(4, 4, cl=1, vl=1, vo=1),
    "x360-top-spin-4": M(4, 4, cl=1, vl=1, vo=1),
    "x360-virtua-tennis-3": M(4, 4, cl=1, vl=1, vo=1),
    "x360-virtua-tennis-2009": M(4, 4, cl=1, vl=1, vo=1),
    "x360-virtua-tennis-4": M(4, 4, cl=1, vl=1, vo=1),
    "x360-rockstar-games-presents-table-tennis": M(2, 2, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-06": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-07": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-08": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-09": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-10": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-11": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-12-the-masters": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-13": M(4, 4, vl=1, vo=1),
    "x360-tiger-woods-pga-tour-14": M(4, 4, vl=1, vo=1),
    "x360-blitz-the-league": M(2, 2, vl=1, vo=1),
    "x360-blitz-the-league-ii": M(2, 2, vl=1, vo=1),
    # ---- Puzzle / tabuleiro / party ----
    "x360-uno": M(4, 4, vl=1, vo=1),
    "x360-uno-rush": M(4, 6, vl=1, vo=1),
    "x360-catan": M(4, 4, vl=1, vo=1),
    "x360-carcassonne": M(4, 5, vl=1, vo=1),
    "x360-monopoly": M(4, 4, vl=1, vo=1),
    "x360-monopoly-streets": M(4, 4, vl=1, vo=1),
    "x360-monopoly-plus": M(6, 6, vl=1, vo=1),
    "x360-risk-factions": M(5, 5, vl=1, vo=1),
    "x360-trivial-pursuit": M(4, 4, vl=1, vo=1),
    "x360-trivial-pursuit-live": M(4, 4, vl=1, vo=1),
    "x360-scene-it-lights-camera-action": M(4, 4, vl=1, vo=1),
    "x360-scene-it-box-office-smash": M(4, 4, vl=1, vo=1),
    "x360-scene-it-bright-lights-big-screen": M(4, 0, vl=1),
    "x360-scene-it-movie-night": M(4, 0, vl=1),
    "x360-you-don-t-know-jack": M(4, 4, vl=1, vo=1),
    "x360-hasbro-family-game-night-battleship": M(4, 4, vl=1, vo=1),
    "x360-hasbro-family-game-night-yahtzee": M(4, 4, vl=1, vo=1),
    "x360-bejeweled-2": M(2, 0, vl=1),
    "x360-bejeweled-3": M(2, 0, vl=1),
    "x360-bejeweled-blitz-live": M(4, 4, vl=1, vo=1),
    "x360-peggle": M(2, 0, vl=1),
    "x360-peggle-2": M(2, 2, vl=1, vo=1),
    "x360-plants-vs-zombies": M(2, 0, cl=1, vl=1),
    "x360-puzzle-quest-challenge-of-the-warlords": M(2, 2, vl=1, vo=1),
    "x360-puzzle-quest-galactrix": M(2, 2, vl=1, vo=1),
    "x360-puzzle-quest-2": M(2, 2, vl=1, vo=1),
    "x360-poker-smash": M(2, 2, vl=1, vo=1),
    "x360-full-house-poker": M(0, 6, vo=1),
    "x360-poker-night-2": M(),
    "x360-pinball-fx": M(4, 4, vl=1, vo=1),
    "x360-pinball-fx-2": M(4, 4, vl=1, vo=1),
    "x360-worms": M(4, 4, vl=1, vo=1),
    "x360-worms-2-armageddon": M(4, 4, vl=1, vo=1),
    "x360-worms-revolution": M(4, 4, vl=1, vo=1),
    "x360-worms-ultimate-mayhem": M(4, 4, vl=1, vo=1),
    "x360-magic-the-gathering-duels-of-the-planeswalkers": M(0, 4, vo=1),
    "x360-magic-the-gathering-2012": M(0, 4, vo=1),
    "x360-magic-the-gathering-2013": M(0, 4, vo=1),
    "x360-magic-the-gathering-2014": M(0, 4, vo=1),
    "x360-magic-the-gathering-2015": M(0, 4, vo=1),
    "x360-zuma": M(),
    "x360-zuma-s-revenge": M(2, 0, vl=1),
}


# --------------------------------------------------------------------------
# 2) priors por genero (para jogos sem artigo ou com confidence low)
# --------------------------------------------------------------------------

def P(**kw):
    d = M(**kw)
    d["source"] = "genre-prior"
    d["confidence"] = "low"
    return d


GENRE_PRIORS = [
    (r"fighting|beat ?'?em ?up|hack (?:and|&) slash|wrestl", P(loc=2, onl=2, vl=1, vo=1)),
    (r"kinect|exergame|fitness|dance|rhythm|karaoke|singing", P(loc=2, cl=1, vl=1)),
    (r"party|trivia|game show|card|board|family|educational|quiz|poker|chess", P(loc=4, vl=1)),
    (r"music", P(loc=2, cl=1, vl=1)),
    (r"racing|flying|driving|vehicular|kart", P(loc=2, onl=8, vl=1, vo=1)),
    (r"sports|recreation|bowling|golf|tennis|baseball|rugby|olympic|hunting|fishing", P(loc=4, onl=2, vl=1, vo=1)),
    (r"shooter|shoot ?'?em ?up|bullet hell|mecha|tank", P(loc=0, onl=8, vo=1)),
    (r"strategy|rts|rtt|tactic|tower defense|wargame|god game", P(loc=0, onl=4, vo=1)),
    (r"puzzle|platform|visual novel|adventure|role|rpg|sim|stealth|survival horror|"
     r"open world|sandbox|action|classics|compilation|pinball|application|fantasy|western", P()),
]

KINECT_PRIOR = P(loc=2, cl=1, vl=1)
DEFAULT_PRIOR = P()


def genre_prior(game):
    g = (game.get("genre") or "").lower()
    if (game.get("flags") or {}).get("kinect"):
        return dict(KINECT_PRIOR)
    for pat, tags in GENRE_PRIORS:
        if re.search(pat, g):
            return dict(tags)
    return dict(DEFAULT_PRIOR)


# --------------------------------------------------------------------------
# 3) capas
# --------------------------------------------------------------------------

FILE_RE = re.compile(r"(?:\[\[\s*(?:File|Image)\s*:\s*)?([^\[\]{}|<>\n]+?\.(?:jpg|jpeg|png|gif|svg|webp))", re.I)


def image_filename(wikitext):
    """Nome do arquivo da capa a partir da Infobox video game (ou 1o File: do artigo)."""
    ib = t.extract_infobox(wikitext or "")
    raw = ib.get("image") or ib.get("cover") or ib.get("image1") or ""
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)
    raw = re.sub(r"</?noinclude>", "", raw, flags=re.I)
    m = FILE_RE.search(raw)
    if not m:
        head = (wikitext or "")[:4000]
        m = re.search(r"\[\[\s*(?:File|Image)\s*:\s*([^\[\]|<>\n]+?\.(?:jpg|jpeg|png|gif|svg|webp))", head, re.I)
    if not m:
        return None
    name = m.group(1).strip().replace("_", " ")
    if not name or name.lower() in ("none", "blank.png", "x.png"):
        return None
    return name


def clean_url(url):
    if not url:
        return None
    url = url.split("?")[0]
    url = url.replace("https://thumb.wikimedia.org/", "https://upload.wikimedia.org/")
    return url


def resolve_files(names, size=400):
    """{'Nome.jpg': url} via action=query&prop=imageinfo (funciona com arquivos nao-livres)."""
    out = {}
    names = [n for n in names if n]
    for i in range(0, len(names), 50):
        chunk = names[i:i + 50]
        titles = ["File:" + n for n in chunk]
        try:
            d = w.api({"action": "query", "prop": "imageinfo", "iiprop": "url",
                       "iiurlwidth": str(size), "redirects": "1", "titles": "|".join(titles)})
        except Exception as e:
            print("  ! imageinfo falhou no lote %d: %s" % (i // 50, e))
            continue
        q = d.get("query", {})
        norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
        redir = {r["from"]: r["to"] for r in q.get("redirects", [])}
        by_title = {}
        for p in q.get("pages", []):
            ii = (p.get("imageinfo") or [{}])[0]
            url = ii.get("thumburl") or ii.get("url")
            if url:
                by_title[p["title"]] = clean_url(url)
        for n, tt in zip(chunk, titles):
            res = redir.get(norm.get(tt, tt), norm.get(tt, tt))
            if res in by_title:
                out[n] = by_title[res]
    return out


# --------------------------------------------------------------------------
# 4) System Link (fonte autoritativa de multiplayer local)
# --------------------------------------------------------------------------

def norm_title(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\((?:indie|arcade|xna game|xbla|video game|xbox 360|game)\)", " ", s)
    s = re.sub(r"\bthe\b|\band\b|[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def cell_num(c):
    m = re.search(r"\d+", w.strip_wiki(c or "") or "")
    return int(m.group(0)) if m else None


def load_systemlink():
    """{chave_normalizada: {'total':n,'per_console':n,'versus':n,'coop':n}}"""
    wt = w.fetch_wikitext(SYSLINK_PAGE)
    # iter_table_rows so acha a tabela via id=; sem id o rfind erra por 1 e devolve vazio.
    wt = re.sub(r'\{\|\s*class="wikitable', '{| id="softwarelist" class="wikitable', wt, count=1)
    out = {}
    for cells in w.iter_table_rows(wt):
        clean = [w.strip_wiki(re.sub(r'^[^|]*\|', '', c)).lower() for c in cells]
        # cabecalho real: Title | Total players | Per console | Versus mode | Co-op mode | Notes
        if "title" in clean[:1] and any("players" in c for c in clean):
            print("  cabecalho System Link:", clean)
            continue
        if len(cells) < 5 or not w.strip_wiki(cells[0]):
            continue
        title_cell = cells[0]
        rec = {"total": cell_num(cells[1]), "per_console": cell_num(cells[2]),
               "versus": cell_num(cells[3]), "coop": cell_num(cells[4])}
        keys = set()
        lt = w.link_target(title_cell)
        if lt:
            keys.add(norm_title(lt))
        disp = w.strip_wiki(title_cell)
        if disp:
            keys.add(norm_title(disp))
            keys.add(norm_title(re.sub(r"\([^)]*\)\s*$", "", disp)))
        for k in keys:
            if k and k not in out:
                out[k] = rec
    return out


# --------------------------------------------------------------------------
# 5) coerencia
# --------------------------------------------------------------------------

KEYS = ["singlePlayer", "multiplayerLocal", "multiplayerOnline", "coop", "coopLocal",
        "coopOnline", "versus", "versusLocal", "maxPlayersLocal", "maxPlayersOnline",
        "maxPlayers", "source", "confidence"]


def fix_coherence(e):
    """Conserta incoerencias logicas. Devolve lista dos problemas corrigidos."""
    bad = []

    def setv(k, v, why):
        if e[k] != v:
            e[k] = v
            bad.append(why)

    for k in ("singlePlayer", "multiplayerLocal", "multiplayerOnline", "coop",
              "coopLocal", "coopOnline", "versus", "versusLocal"):
        e[k] = bool(e.get(k))
    for k in ("maxPlayersLocal", "maxPlayersOnline", "maxPlayers"):
        try:
            e[k] = max(0, int(e.get(k) or 0))
        except (TypeError, ValueError):
            e[k] = 0

    ml, mo = e["multiplayerLocal"], e["multiplayerOnline"]
    if not ml and not mo:
        for k in ("coop", "coopLocal", "coopOnline", "versus", "versusLocal"):
            setv(k, False, "%s=true sem multiplayer" % k)
        for k in ("maxPlayersLocal", "maxPlayersOnline", "maxPlayers"):
            setv(k, 0, "%s>0 sem multiplayer" % k)
        setv("singlePlayer", True, "sem nenhum modo")
        return bad

    if e["coopLocal"] and not ml:
        setv("coopLocal", False, "coopLocal sem multiplayerLocal")
    if e["coopOnline"] and not mo:
        setv("coopOnline", False, "coopOnline sem multiplayerOnline")
    if e["versusLocal"] and not ml:
        setv("versusLocal", False, "versusLocal sem multiplayerLocal")
    if e["coop"] and not (e["coopLocal"] or e["coopOnline"]):
        if mo:
            setv("coopOnline", True, "coop sem coopLocal/coopOnline")
        else:
            setv("coopLocal", True, "coop sem coopLocal/coopOnline")
    if not e["coop"] and (e["coopLocal"] or e["coopOnline"]):
        setv("coop", True, "coopLocal/Online sem coop")
    if e["versusLocal"] and not e["versus"]:
        setv("versus", True, "versusLocal sem versus")
    if e["versus"] and not e["versusLocal"] and not mo:
        setv("versusLocal", True, "versus so local sem versusLocal")
    if not e["coop"] and not e["versus"]:
        setv("versus", True, "multiplayer sem coop nem versus")
        if ml:
            setv("versusLocal", True, "multiplayer sem coop nem versus")

    if ml and e["maxPlayersLocal"] < 2:
        setv("maxPlayersLocal", 2, "multiplayerLocal com maxPlayersLocal<2")
    if not ml:
        setv("maxPlayersLocal", 0, "maxPlayersLocal>0 sem multiplayerLocal")
    if mo and e["maxPlayersOnline"] < 2:
        setv("maxPlayersOnline", 2, "multiplayerOnline com maxPlayersOnline<2")
    if not mo:
        setv("maxPlayersOnline", 0, "maxPlayersOnline>0 sem multiplayerOnline")
    setv("maxPlayers", max(e["maxPlayersLocal"], e["maxPlayersOnline"]), "maxPlayers != max(local, online)")
    return bad


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

SPOT = ["x360-halo-3", "x360-gears-of-war-2", "x360-call-of-duty-4-modern-warfare",
        "x360-forza-motorsport-4", "x360-left-4-dead-2", "x360-minecraft-xbox-360-edition",
        "x360-portal-2", "x360-lego-star-wars-the-complete-saga", "x360-castle-crashers",
        "x360-the-elder-scrolls-v-skyrim", "x360-street-fighter-iv", "x360-fifa-14"]


def main():
    games = json.load(open(SRC, encoding="utf-8"))
    print("jogos: %d" % len(games))

    titles = sorted({g["wiki"] for g in games if g.get("wiki")})
    print("artigos distintos: %d" % len(titles))

    print("[1/5] baixando wikitext...")
    wt = w.batch_wikitext(titles)
    print("      wikitext: %d/%d" % (len(wt), len(titles)))

    print("[2/5] capas...")
    imgs = {k: clean_url(v) for k, v in w.batch_images(titles, 400).items()}
    print("      pageimages (so arquivos livres): %d" % len(imgs))
    want = {}
    for tl in titles:
        if tl in imgs or tl not in wt:
            continue
        fn = image_filename(wt[tl])
        if fn:
            want[tl] = fn
    resolved = resolve_files(sorted(set(want.values())))
    for tl, fn in want.items():
        if resolved.get(fn):
            imgs[tl] = resolved[fn]
    print("      total com capa: %d/%d artigos" % (len(imgs), len(titles)))

    print("[3/5] System Link...")
    syslink = load_systemlink()
    print("      chaves System Link: %d" % len(syslink))

    print("[4/5] montando tags...")
    tags, stats = {}, Counter()
    for g in games:
        gid, wk = g["id"], g.get("wiki")
        if wk and wk in wt:
            e = t.build_tags(wt[wk])
            stats["auto"] += 1
        else:
            e = genre_prior(g)
            stats["sem-artigo"] += 1

        # --- System Link: prioridade sobre a heuristica de texto ---
        sl = syslink.get(norm_title(wk or "")) or syslink.get(norm_title(g["title"]))
        if sl:
            stats["systemlink"] += 1
            per = sl.get("per_console")
            per = int(per) if (isinstance(per, int) or
                               (isinstance(per, str) and per.isdigit())) else None
            # per_console == 1 quer dizer UM jogador por console (so LAN, sem tela
            # dividida). Colapsar isso com "desconhecido" inventava split-screen de 2.
            sem_local = per == 1
            per = per or 0
            if not sem_local:
                e["multiplayerLocal"] = True
            # so o split-screen ("Per console") vira maxPlayersLocal; "Total players" e' o
            # total via System Link (varios consoles) e inflaria o numero de sofa.
            if per >= 2:
                e["maxPlayersLocal"] = per
            elif not sem_local and e["maxPlayersLocal"] < 2:
                e["maxPlayersLocal"] = 2
            if sl.get("coop"):
                e["coop"] = True
                e["coopLocal"] = True
            if sl.get("versus"):
                e["versus"] = True
                e["versusLocal"] = True
            if e["source"] in ("wikipedia-text", "genre-prior"):
                e["source"] = "systemlink"
            if e["confidence"] == "low":
                e["confidence"] = "medium"

        # --- prior por genero para o que ficou fraco ---
        if e["confidence"] == "low" and e["source"] != "genre-prior":
            e = genre_prior(g)
            stats["prior-low"] += 1

        e["image"] = imgs.get(wk) if wk else None
        tags[gid] = e

    print("[5/5] correcoes manuais...")
    unknown = [k for k in MANUAL if k not in tags]
    if unknown:
        print("      !! ids manuais inexistentes (%d): %s" % (len(unknown), unknown[:10]))
    applied = 0
    for gid, man in MANUAL.items():
        if gid not in tags:
            continue
        old = tags[gid]
        new = dict(man)
        if new.pop("_keep_local", False):
            for k in ("multiplayerLocal", "maxPlayersLocal", "coopLocal", "versusLocal"):
                new[k] = old[k]
            new["coop"] = new["coop"] or new["coopLocal"]
            new["versus"] = new["versus"] or new["versusLocal"]
        new["image"] = old.get("image")
        tags[gid] = new
        applied += 1
    print("      correcoes manuais aplicadas: %d" % applied)

    # --- validacao de coerencia ---
    issues = Counter()
    for gid, e in tags.items():
        for why in fix_coherence(e):
            issues[why] += 1
    if issues:
        print("\nincoerencias CORRIGIDAS:")
        for why, n in issues.most_common():
            print("   %5d  %s" % (n, why))
    # segunda passada: tem de vir limpo
    left = sum(len(fix_coherence(e)) for e in tags.values())
    print("incoerencias restantes apos conserto: %d" % left)

    # --- ordem estavel das chaves + gravacao ---
    ordered = {}
    for g in games:
        e = tags[g["id"]]
        ordered[g["id"]] = {"image": e.get("image")}
        for k in KEYS:
            ordered[g["id"]][k] = e[k]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(ordered, f, ensure_ascii=False, indent=1)
    print("\ngravado data/tags-x360.json (%d entradas, %.1f KB)"
          % (len(ordered), os.path.getsize(OUT) / 1024))

    # --- relatorio ---
    ids = {g["id"] for g in games}
    print("\ncobertura: %d/%d ids (faltando: %d)"
          % (len(ordered), len(ids), len(ids - set(ordered))))
    n = len(ordered)
    print("com imagem: %d (%.1f%%)" % (sum(1 for e in ordered.values() if e["image"]),
                                       100.0 * sum(1 for e in ordered.values() if e["image"]) / n))
    for k in KEYS[:8]:
        c = sum(1 for e in ordered.values() if e[k])
        print("  %-18s %5d (%.1f%%)" % (k, c, 100.0 * c / n))
    print("confidence:", dict(Counter(e["confidence"] for e in ordered.values())))
    print("source:", dict(Counter(e["source"] for e in ordered.values())))
    print("etapas:", dict(stats))

    print("\nSPOT-CHECK")
    hdr = "%-46s %-4s %-4s %-4s %-4s %-4s %-4s %-4s %-4s %5s %5s" % (
        "jogo", "SP", "LOC", "ONL", "COOP", "cLOC", "cONL", "VS", "vLOC", "maxL", "maxO")
    print(hdr)
    print("-" * len(hdr))
    by_id = {g["id"]: g for g in games}
    for gid in SPOT:
        e = ordered.get(gid)
        if not e:
            print("%-46s AUSENTE" % gid)
            continue
        b = lambda k: "sim" if e[k] else "-"
        print("%-46s %-4s %-4s %-4s %-4s %-4s %-4s %-4s %-4s %5d %5d  [%s/%s] img=%s" % (
            by_id[gid]["title"][:46], b("singlePlayer"), b("multiplayerLocal"),
            b("multiplayerOnline"), b("coop"), b("coopLocal"), b("coopOnline"),
            b("versus"), b("versusLocal"), e["maxPlayersLocal"], e["maxPlayersOnline"],
            e["source"], e["confidence"], "sim" if e["image"] else "NAO"))


if __name__ == "__main__":
    main()
