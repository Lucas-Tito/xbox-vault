#!/usr/bin/env python3
"""Capas/logos extras: fontes que nao sao Wikipedia nem LaunchBox.

As entradas da Wikipedia e do dump do LaunchBox ja sao tratadas por
tools/fetch_images.py e tools/fetch_images_launchbox.py. Este script cobre o
resto do catalogo -- jogos obscuros (TheGamesDB, libretro-thumbnails) e os
homebrews, que nunca tiveram caixa e por isso usam logo, icone ou captura de
tela do proprio projeto (GitHub, GameBrew, Free60, Internet Archive...).

Cada entrada de EXTRA_IMAGES aponta para uma URL que foi conferida a mao: a
imagem e daquele titulo (e, quando a arte difere por plataforma, da versao de
Xbox/Xbox 360). Campos opcionais:
    frame  indice do quadro a usar quando a origem e um GIF animado
    crop   (left, top, right, bottom) recortado antes do redimensionamento

Pipeline identico ao de tools/fetch_images.py: 240px de largura (so reduz),
LANCZOS, RGB achatado sobre (28, 36, 46) quando ha transparencia, WEBP q72 m6.

Resumivel e idempotente: pula o que ja existe em images/, entao da para
interromper e rodar de novo sem rebaixar nada.
"""
import concurrent.futures as cf
import io, os, sys, threading, time, urllib.error, urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "images")
WIDTH, QUALITY, WORKERS = 240, 72, 3
UA = ("XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault) Python-urllib")

# id do jogo -> {url, src, [frame], [crop]}
EXTRA_IMAGES = {
    # --- README do proprio projeto, escolhidas a mao ---
    # A primeira imagem do README nao serve como heuristica: no Theseus ela e o
    # logo do Vulkan e no ButterAndJelly e uma captura de Wii U. Estas quatro
    # foram conferidas uma a uma; os outros 12 repos nao tem imagem aproveitavel.
    "hb-theseus-dashboard": {
        "url": "https://raw.githubusercontent.com/MrMilenko/Theseus/HEAD/docs/images/xbox-dashboard.png",
        "src": "README do projeto (GitHub)"},
    "hb-butterandjelly": {
        "url": "https://raw.githubusercontent.com/MrMilenko/ButterAndJelly/HEAD/docs/screenshots/xbox360-home.png",
        "src": "README do projeto (GitHub)"},
    "hb-anarch360": {
        "url": "https://raw.githubusercontent.com/Fhoughton/Anarch360/HEAD/media/logo_big.png",
        "src": "README do projeto (GitHub)"},
    "hb-eineko": {
        "url": "https://raw.githubusercontent.com/faithvoid/eineko/HEAD/screenshots/1.jpg",
        "src": "README do projeto (GitHub)"},
    # --- ConsoleMods ---
    "hb-aurora-dash": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/2/23/Aurora-jtag-360-dashboard.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-emerald-dash": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/2/20/Emerald_Dash.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-freestyle-dash-3": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/3/38/FSD3_Stock.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-ingeniuox": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/9/95/IngeniouX.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-viper360": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/4/42/Viper360_Dash.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-xenu-dash": {
        "url": "https://web.archive.org/web/20250811134941id_/https://consolemods.org/wiki/images/e/e0/Xenu_Dashboard.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-xexdash": {
        "url": "https://web.archive.org/web/20250811134941id_/https://consolemods.org/wiki/images/6/6b/XeXDash.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-xexloader": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/7/77/XeXLoader.png",
        "src": "ConsoleMods wiki (Wayback)"},
    "hb-xexmenu": {
        "url": "https://web.archive.org/web/20250811134942id_/https://consolemods.org/wiki/images/b/b5/XeXMenu_Apps.png",
        "src": "ConsoleMods wiki (Wayback)"},
    # --- Free60 ---
    "hb-360flashtool": {
        "url": "https://free60.org/images/360Flash_logo.png",
        "src": "Free60 wiki"},
    "hb-freemyxe": {
        "url": "https://free60.org/Hacks/images/BU-FreeMyXe.png",
        "src": "Free60 wiki"},
    "hb-pong-360": {
        "url": "https://free60.org/images/PongScreen.jpg",
        "src": "Free60 wiki",
        "crop": (8, 48, 556, 396)},
    "hb-xell-reloaded": {
        "url": "https://free60.org/Hacks/images/BU-XeLL.png",
        "src": "Free60 wiki"},
    # --- GameBrew ---
    "hb-arcadian-tactics": {
        "url": "https://www.gamebrew.org/images/c/cc/Arcadiantactics2.png",
        "src": "GameBrew"},
    "hb-beatsofragex": {
        "url": "https://www.gamebrew.org/images/4/45/Beatsofragex2.png",
        "src": "GameBrew"},
    "hb-daphnex": {
        "url": "https://www.gamebrew.org/images/0/08/Daphnex2.png",
        "src": "GameBrew"},
    "hb-desmumex": {
        "url": "https://www.gamebrew.org/images/9/9d/Desmumex2.png",
        "src": "GameBrew"},
    "hb-didntxspectrum": {
        "url": "https://www.gamebrew.org/images/9/92/Didntxspectrum2.png",
        "src": "GameBrew"},
    "hb-final-burn-consoles": {
        "url": "https://www.gamebrew.org/images/c/c1/Fbcxbox2.png",
        "src": "GameBrew"},
    "hb-final-burn-legends": {
        "url": "https://www.gamebrew.org/images/4/41/Finalburnlegends2.png",
        "src": "GameBrew"},
    "hb-hodex": {
        "url": "https://www.gamebrew.org/images/9/93/Hodex2.png",
        "src": "GameBrew"},
    "hb-kixxx": {
        "url": "https://www.gamebrew.org/images/c/c5/Kixxx2.png",
        "src": "GameBrew"},
    "hb-madrigalx": {
        "url": "https://www.gamebrew.org/images/d/dc/Madrigalx2.png",
        "src": "GameBrew"},
    "hb-magnetron": {
        "url": "https://www.gamebrew.org/images/3/39/Magnetronxbox2.png",
        "src": "GameBrew"},
    "hb-messoxtras": {
        "url": "https://www.gamebrew.org/images/9/96/Messoxtras2.png",
        "src": "GameBrew"},
    "hb-muchimex": {
        "url": "https://www.gamebrew.org/images/8/8e/Muchimex2.png",
        "src": "GameBrew"},
    "hb-neko-project2x": {
        "url": "https://www.gamebrew.org/images/f/f8/Nekoproject2x2.png",
        "src": "GameBrew"},
    "hb-openbor-xbox": {
        "url": "https://www.gamebrew.org/images/6/6c/Openborxbox2.png",
        "src": "GameBrew"},
    "hb-opentyrianx": {
        "url": "https://www.gamebrew.org/images/d/df/Opentyrianx2.png",
        "src": "GameBrew"},
    "hb-pokemonminix": {
        "url": "https://www.gamebrew.org/images/6/64/Pokemonminix2.png",
        "src": "GameBrew"},
    "hb-star-wars-xbox-hb": {
        "url": "https://www.gamebrew.org/images/3/37/Starwarssp2.png",
        "src": "GameBrew"},
    "hb-super-mario-war-xbox": {
        "url": "https://www.gamebrew.org/images/2/2b/Smwxbox2.png",
        "src": "GameBrew"},
    "hb-supervisionx": {
        "url": "https://www.gamebrew.org/images/7/76/Supervisionx2.png",
        "src": "GameBrew"},
    "hb-uzeboxx": {
        "url": "https://www.gamebrew.org/images/0/02/Uzeboxx2.png",
        "src": "GameBrew"},
    "hb-virtualboyx": {
        "url": "https://www.gamebrew.org/images/0/0d/Virtualboyx2.png",
        "src": "GameBrew"},
    "hb-x-pong": {
        "url": "https://www.gamebrew.org/images/3/3b/Xpong2.png",
        "src": "GameBrew"},
    "hb-xbomberbox": {
        "url": "https://www.gamebrew.org/images/7/7a/Xbomberboxone2.png",
        "src": "GameBrew"},
    "hb-xboyadvance": {
        "url": "https://www.gamebrew.org/images/c/c1/Xboyadvance2.png",
        "src": "GameBrew"},
    "hb-xraine": {
        "url": "https://www.gamebrew.org/images/5/59/Xraine2.png",
        "src": "GameBrew"},
    "hb-xskull": {
        "url": "https://www.gamebrew.org/images/f/fa/Xskullgec2.png",
        "src": "GameBrew"},
    "hb-xsorr": {
        "url": "https://www.gamebrew.org/images/0/03/Xsorr2.png",
        "src": "GameBrew"},
    "hb-xurquan": {
        "url": "https://www.gamebrew.org/images/4/41/Xurquan2.png",
        "src": "GameBrew"},
    "hb-zelda-roth-xbox": {
        "url": "https://www.gamebrew.org/images/0/04/Zeldarothx2.png",
        "src": "GameBrew"},
    # --- GitHub ---
    "hb-cerbios": {
        "url": "https://avatars.githubusercontent.com/u/194450597?v=4",
        "src": "GitHub org Cerbios"},
    "hb-cerbiostool": {
        "url": "https://github.com/Team-Resurgent/CerbiosTool/raw/main/readmeStuff/Gui1.JPG",
        "src": "GitHub Team-Resurgent/CerbiosTool"},
    "hb-cosmo-enginex": {
        "url": "https://github.com/yuv422/cosmo-engine/raw/master/img/cosmo-engine.png",
        "src": "GitHub Ryzee119/cosmo-engineX"},
    "hb-endgame-exploit": {
        "url": "https://github.com/XboxDev/endgame-exploit/assets/9522648/84c9890a-0d57-4d32-bcd6-d43ff8738ebf",
        "src": "GitHub XboxDev/endgame-exploit"},
    "hb-extract-xiso": {
        "url": "https://user-images.githubusercontent.com/5654654/157920711-8b99699d-ee60-455b-a69c-eefca3fcb3ef.png",
        "src": "GitHub XboxDev/extract-xiso"},
    "hb-fatx-lib": {
        "url": "https://github.com/mborgerson/fatx/raw/master/gfatx/gfatx.png",
        "src": "GitHub mborgerson/fatx"},
    "hb-fbanext-360": {
        "url": "https://github.com/user-attachments/assets/4e4b2fb7-f29b-47db-97ca-7384716fc1f0",
        "src": "GitHub mLoaDs/FBANext360"},
    "hb-ghidra-xbe": {
        "url": "https://user-images.githubusercontent.com/1339483/135558981-1668a2ab-9969-4d2f-b1b3-78307c40ccb2.png",
        "src": "GitHub XboxDev/ghidra-xbe"},
    "hb-hawk-xblc": {
        "url": "https://github.com/Ryzee119/hawk/raw/master/.kitspace/pcb_render.png",
        "src": "GitHub Ryzee119/hawk"},
    "hb-iso2god": {
        "url": "https://github.com/user-attachments/assets/d942054e-24cf-47e6-b779-0d3af342170b",
        "src": "GitHub r4dius/Iso2God"},
    "hb-j-runner": {
        "url": "https://raw.githubusercontent.com/mitchellwaite/J-Runner-with-Extras/dev/J-Runner/Resources/JR.png",
        "src": "GitHub mitchellwaite/J-Runner-with-Extras"},
    "hb-le-fluffie": {
        "url": "https://raw.githubusercontent.com/TrapEmAll/Le-Fluffie/master/Le%20Fluffie/Resources/lf.png",
        "src": "GitHub TrapEmAll/Le-Fluffie"},
    "hb-lightshow-360": {
        "url": "https://raw.githubusercontent.com/DerfJagged/Lightshow/main/Lightshow_Demo.gif",
        "src": "GitHub DerfJagged/Lightshow"},
    "hb-lithiumx": {
        "url": "https://github.com/Ryzee119/LithiumX/raw/master/images/dash_main.jpg",
        "src": "GitHub Ryzee119/LithiumX"},
    "hb-modxo": {
        "url": "https://github.com/Team-Resurgent/Modxo/raw/main/branding/Modxo-horizontal.png",
        "src": "GitHub Team-Resurgent/Modxo"},
    "hb-mupen64-360": {
        "url": "https://github.com/gligli/mupen64-360/raw/master/files/bg.png",
        "src": "GitHub gligli/mupen64-360"},
    "hb-nv2a-trace": {
        "url": "https://i.imgur.com/a2GuIFz.png",
        "src": "GitHub XboxDev/nv2a-trace README"},
    "hb-nxdk": {
        "url": "https://raw.githubusercontent.com/XboxDev/nxdk/master/samples/mesh/screenshot.png",
        "src": "GitHub XboxDev/nxdk"},
    "hb-ogx360": {
        "url": "https://github.com/Ryzee119/ogx360/raw/master/Images/image4.jpg",
        "src": "GitHub Ryzee119/ogx360"},
    "hb-omnispeakx": {
        "url": "https://raw.githubusercontent.com/Ryzee119/omnispeak/xbox/xbox/TitleImage.jpg",
        "src": "GitHub Ryzee119/omnispeak (xbox)"},
    "hb-openbor-360": {
        "url": "https://github.com/mLoaDs/OpenBOR360/raw/main/resources/OpenBOR_Menu_480x272_Xbox.png",
        "src": "GitHub mLoaDs/OpenBOR360"},
    "hb-openxenium": {
        "url": "https://github.com/Ryzee119/OpenXenium/raw/master/Images/openxenium2.jpg",
        "src": "GitHub Ryzee119/OpenXenium"},
    "hb-party-buffalo": {
        "url": "https://raw.githubusercontent.com/landaire/party-buffalo/master/Party%20Buffalo/Main%20Icon.ico",
        "src": "GitHub landaire/party-buffalo"},
    "hb-piprom": {
        "url": "https://raw.githubusercontent.com/grimdoomer/PiPROM/master/images/i2c_xbox.png",
        "src": "GitHub grimdoomer/PiPROM"},
    "hb-project-stellar": {
        "url": "https://github.com/MakeMHz/project-stellar/raw/main/resources/images/logo.png",
        "src": "GitHub MakeMHz/project-stellar"},
    "hb-prometheos": {
        "url": "https://github.com/Team-Resurgent/PrometheOS-Firmware/raw/main/PrometheOSXbe/Artwork/Icon/titleimage.bmp",
        "src": "GitHub Team-Resurgent/PrometheOS-Firmware"},
    "hb-repackinator": {
        "url": "https://github.com/Team-Resurgent/Repackinator/raw/main/readmeStuff/gui.png",
        "src": "GitHub Team-Resurgent/Repackinator"},
    "hb-uix": {
        "url": "https://raw.githubusercontent.com/OfficialTeamUIX/UIX-Skin-Collection/main/RandomBlue/uix_screenshot233414.bmp",
        "src": "GitHub OfficialTeamUIX/UIX-Skin-Collection"},
    "hb-uix-lite": {
        "url": "https://github.com/user-attachments/assets/c719d53c-434f-48cd-9a3c-5f115929e22b",
        "src": "GitHub OfficialTeamUIX/UIX-Lite"},
    "hb-unleashx": {
        "url": "https://raw.githubusercontent.com/rizaumami/unleashx-manual/main/imgs/default_skin.jpg",
        "src": "GitHub rizaumami/unleashx-manual"},
    "hb-vortexion-xbox": {
        "url": "https://github.com/GamingNJncos/XboxPort_vortexion/raw/main/1st.gif",
        "src": "GitHub GamingNJncos/XboxPort_vortexion"},
    "hb-xbdstats": {
        "url": "https://raw.githubusercontent.com/MobCat/xbdStats/refs/heads/main/img/Discord.jpg",
        "src": "GitHub Rocky5/xbdStats"},
    "hb-xbmc-emustation": {
        "url": "https://github.com/Rocky5/XBMC-Emustation/raw/master/Mod%20Files/system/media/splash3.png",
        "src": "GitHub Rocky5/XBMC-Emustation"},
    "hb-xbmc4gamers": {
        "url": "https://github.com/Rocky5/XBMC4Gamers/raw/master/Mod%20Files/system/media/xbmc4gamers.png",
        "src": "GitHub Rocky5/XBMC4Gamers"},
    "hb-xbox-hd-plus-app": {
        "url": "https://github.com/MakeMHz/xbox-hd-plus-app/raw/main/screenshots/main_menu.png",
        "src": "GitHub MakeMHz/xbox-hd-plus-app"},
    "hb-xbox-softmodding-tool": {
        "url": "https://github.com/Rocky5/Xbox-Softmodding-Tool/raw/master/Other/Graphics/banner.png",
        "src": "GitHub Rocky5/Xbox-Softmodding-Tool"},
    "hb-xbox360badupdate": {
        "url": "https://github.com/user-attachments/assets/e9684c9d-d4db-48a8-9661-53629c20e22e",
        "src": "GitHub grimdoomer/Xbox360BadUpdate",
        "frame": 172},
    "hb-xboxeepromeditor": {
        "url": "https://github.com/Ernegien/XboxEepromEditor/raw/master/Images/General.png",
        "src": "GitHub Ernegien/XboxEepromEditor"},
    "hb-xdvdfs": {
        "url": "https://github.com/Ryzee119/xdvdfs/raw/main/xdvdfs-desktop/icons/icon.png",
        "src": "GitHub Ryzee119/xdvdfs"},
    "hb-xebuild-gui": {
        "url": "https://raw.githubusercontent.com/Swizzy/xeBuildGUI/master/xeBuild%20GUI/Resources/logo.png",
        "src": "GitHub Swizzy/xeBuildGUI"},
    "hb-xenium-os": {
        "url": "https://raw.githubusercontent.com/Team-Resurgent/xenium-programmer/main/images/xenium-os.jpg",
        "src": "GitHub Team-Resurgent/xenium-programmer"},
    "hb-xeunshackle": {
        "url": "https://github.com/user-attachments/assets/af37d4ae-4ff6-4175-8f81-47869ff63ed6",
        "src": "GitHub Byrom90/XeUnshackle",
        "frame": 150},
    # --- IGN ---
    "x360-kinect-fun-labs": {
        "url": "https://assets-prd.ignimgs.com/2022/03/17/funlabs-1647478389461.jpg",
        "src": "IGN"},
    "x360-rhythm-party-boom-boom-dance": {
        "url": "https://xbox360media.ign.com/xbox360/image/object/127/127692/rythm_partyxobx.jpg",
        "src": "IGN"},
    # --- Internet ---
    "hb-configmagic": {
        "url": "https://archive.org/download/ConfigMagicv10/ConfigMagicv10.thumbs/Xbox%20ConfigMagic%20v1.0/Media/splash_000013.jpg",
        "src": "Internet Archive ConfigMagicv10"},
    "hb-dson360": {
        "url": "https://archive.org/download/dson-360/DSon360.jpg",
        "src": "Internet Archive dson-360"},
    "hb-dvd2xbox": {
        "url": "https://archive.org/download/dvd2xbox-0.6.1/dvd2xbox-01.jpg",
        "src": "Internet Archive dvd2xbox-0.6.1"},
    "hb-hexen-toolkit": {
        "url": "https://archive.org/download/hexen2018/Hexen-heimdalls-xbox-engineering-disc-xbox.png",
        "src": "Internet Archive hexen2018"},
    "hb-modio": {
        "url": "https://archive.org/download/modio-3/image.PNG",
        "src": "Internet Archive modio-3"},
    "hb-slayers-auto-installer": {
        "url": "https://archive.org/download/xbox-slayers/image.jpg",
        "src": "Internet Archive xbox-slayers"},
    "hb-xmugen": {
        "url": "https://archive.org/download/Xbox_XMugen/fanart.jpg",
        "src": "Internet Archive Xbox_XMugen"},
    # --- LaunchBox ---
    "x360-ea-sports-fantasy-football-live-draft-tracker": {
        "url": "https://images.launchbox-app.com//2cf090c0-6f13-48ec-ab9f-16a09ba1ed6e.jpg",
        "src": "LaunchBox site (imagem nao presente no dump)"},
    "x360-ea-sports-fantasy-football-live-score-tracker": {
        "url": "https://images.launchbox-app.com//0e5722c4-c5d3-470a-b63f-90539d69cc74.jpg",
        "src": "LaunchBox site (imagem nao presente no dump)"},
    # --- SourceForge ---
    "hb-nexgen": {
        "url": "https://a.fsdn.com/con/app/proj/nexgen/screenshots/27206.jpg/max/max/1",
        "src": "SourceForge nexgen"},
    # --- Steam ---
    "hb-fursan-al-aqsa": {
        "url": "https://cdn.akamai.steamstatic.com/steam/apps/1714420/header.jpg",
        "src": "Steam (appid 1714420)"},
    # --- TheGamesDB ---
    "x360-amaneka-of-dawn-and-the-deep-blue-golem": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/84016-1.jpg",
        "src": "TheGamesDB"},
    "x360-bullet-soul": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/23932-1.jpg",
        "src": "TheGamesDB"},
    "x360-country-dance-all-stars": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/40681-1.jpg",
        "src": "TheGamesDB"},
    "x360-damage-inc-pacific-squadron-ww2": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/40132-1.jpg",
        "src": "TheGamesDB"},
    "x360-deca-sports-freedom-sports-island-freedom-in-pal-region": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/14194-1.jpg",
        "src": "TheGamesDB"},
    "x360-every-extend-extra-extreme-e4": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/54920-1.jpg",
        "src": "TheGamesDB"},
    "x360-jeopardy-america-s-favorite-quiz-show": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/13536-1.jpg",
        "src": "TheGamesDB"},
    "x360-karaoke-revolution-glee-volume-3": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/115908-1.jpg",
        "src": "TheGamesDB"},
    "x360-le-tour-de-france-2009-the-official-game": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/54807-1.jpg",
        "src": "TheGamesDB"},
    "x360-love-football": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/69931-1.jpg",
        "src": "TheGamesDB"},
    "x360-love-tore-bitter-a-k-a-love-tra": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/117931-1.jpg",
        "src": "TheGamesDB"},
    "x360-love-tore-mint-a-k-a-love-tra": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/117933-1.jpg",
        "src": "TheGamesDB"},
    "x360-love-tore-sweet-a-k-a-love-tra": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/117934-1.jpg",
        "src": "TheGamesDB"},
    "x360-maji-ten-maji-de-tenshi-o-tsukutte-mita": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/80985-1.jpg",
        "src": "TheGamesDB"},
    "x360-my-body-coach-3": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/72943-1.jpg",
        "src": "TheGamesDB"},
    "x360-national-geo-challenge": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/8877-1.jpg",
        "src": "TheGamesDB"},
    "x360-national-geo-challenge-wild-life": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/60992-1.jpg",
        "src": "TheGamesDB"},
    "x360-ncis-the-game": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/12335-1.jpg",
        "src": "TheGamesDB"},
    "x360-r-type-dimensions-r-type-and-r-type-ii": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/54775-1.jpg",
        "src": "TheGamesDB"},
    "x360-realms-of-ancient-war-a-k-a-r-a-w": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/16313-1.jpg",
        "src": "TheGamesDB"},
    "x360-rock-band-classic-rock-track-pack": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/16353-1.jpg",
        "src": "TheGamesDB"},
    "x360-tour-de-france-2014": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/65922-1.jpg",
        "src": "TheGamesDB"},
    "x360-winter-sports-2011": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/102516-1.jpg",
        "src": "TheGamesDB"},
    "x360-yoostar-2": {
        "url": "https://cdn.thegamesdb.net/images/original/boxart/front/14305-1.jpg",
        "src": "TheGamesDB"},
    # --- Zen ---
    "x360-star-wars-pinball-heroes-within": {
        "url": "https://zenstudios.com/wp-content/uploads/2020/07/WEB_SW_heroes.jpg",
        "src": "Zen Studios"},
    "x360-star-wars-pinball-the-force-awakens": {
        "url": "https://zenstudios.com/wp-content/uploads/2020/07/WEB_SW_force-1.jpg",
        "src": "Zen Studios"},
    # --- itch.io ---
    "hb-nestbound": {
        "url": "https://img.itch.zone/aW1nLzIxOTk4MDkxLnBuZw==/original/ohJrF%2F.png",
        "src": "itch.io jaredlevi"},
    "hb-quadcarnage": {
        "url": "https://img.itch.zone/aW1nLzIwNDE3Nzk0LnBuZw==/original/OYlTaY.png",
        "src": "itch.io jaredlevi"},
    "hb-wowjay": {
        "url": "https://img.itch.zone/aW1nLzIyNzE0OTc5LnBuZw==/original/3pRhV8.png",
        "src": "itch.io jaredlevi"},
    # --- lantus-x.com ---
    "hb-sarienx": {
        "url": "https://web.archive.org/web/20030522080655im_/http://www.lantus-x.com:80/images/sarienX1.JPG",
        "src": "lantus-x.com (Wayback)"},
    # --- libretro-thumbnails ---
    "xbox-daemon-vector-gui-yi": {
        "url": "https://thumbnails.libretro.com/Microsoft%20-%20Xbox/Named_Boxarts/Daemon%20Vector%20%28Australia%29.png",
        "src": "libretro-thumbnails"},
    "xbox-namco-museum-50th-anniversary": {
        "url": "https://thumbnails.libretro.com/Microsoft%20-%20Xbox/Named_Boxarts/Namco%20Museum%20-%2050th%20Anniversary%20Arcade%20Collection%20%28USA%29.png",
        "src": "libretro-thumbnails"},
    "xbox-pro-cast-sports-fishing": {
        "url": "https://thumbnails.libretro.com/Microsoft%20-%20Xbox/Named_Boxarts/Pro%20Cast%20Sports%20Fishing%20%28USA%29.png",
        "src": "libretro-thumbnails"},
    "xbox-room-zoom": {
        "url": "https://thumbnails.libretro.com/Microsoft%20-%20Xbox/Named_Boxarts/Room%20Zoom%20-%20Race%20for%20Impact%20%28USA%29.png",
        "src": "libretro-thumbnails"},
    "xbox-tour-de-france": {
        "url": "https://thumbnails.libretro.com/Microsoft%20-%20Xbox/Named_Boxarts/Le%20Tour%20de%20France%20%28Europe%29.png",
        "src": "libretro-thumbnails"},
    # --- openxdk.sourceforge.net ---
    "hb-openxdk": {
        "url": "https://web.archive.org/web/20021223221504im_/http://openxdk.sourceforge.net:80/images/openxdk_banner.gif",
        "src": "openxdk.sourceforge.net (Wayback)"},
    # --- teamavalaunch.com ---
    "hb-avalaunch": {
        "url": "https://web.archive.org/web/20050102150200im_/http://www.teamavalaunch.com/screenshots/menu.jpg",
        "src": "teamavalaunch.com (Wayback)"},
    "hb-evolutionx": {
        "url": "https://web.archive.org/web/20050102150203im_/http://www.teamavalaunch.com/screenshots/evox-menu.jpg",
        "src": "teamavalaunch.com (Wayback)"},
    # --- wemod.com ---
    "hb-horizon-360": {
        "url": "https://www.wemod.com/static/images/views/horizon/horizon-screenshot-b104a3c60d.png",
        "src": "wemod.com (Horizon)"},
    # --- xboxmediaplayer.de ---
    "hb-xbmp": {
        "url": "https://web.archive.org/web/20020816194718im_/http://xboxmediaplayer.de:80/newweb/imgs/build3-gui.jpg",
        "src": "xboxmediaplayer.de (Wayback)"},
}

lock = threading.Lock()
stat = {"ok": 0, "skip": 0, "fail": 0}


def fetch(url, tries=5):
    delay = 2.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503) and n < tries - 1:
                time.sleep(delay); delay *= 2; continue
            return None
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.6
    return None


def work(item):
    gid, spec = item
    dest = os.path.join(OUT, gid + ".webp")
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        with lock: stat["skip"] += 1
        return
    raw = fetch(spec["url"])
    if not raw or len(raw) < 1200:
        with lock: stat["fail"] += 1
        print("  falhou: %s" % gid, flush=True)
        return
    try:
        im = Image.open(io.BytesIO(raw))
        if spec.get("frame") is not None:
            im.seek(spec["frame"])
        im.load()
        if im.width < 120:
            raise ValueError("imagem pequena demais: %dx%d" % im.size)
        if spec.get("crop"):
            im = im.crop(tuple(spec["crop"]))
        if im.mode in ("RGBA", "LA", "P"):
            bg = Image.new("RGB", im.size, (28, 36, 46))
            im = im.convert("RGBA")
            bg.paste(im, mask=im.split()[-1])
            im = bg
        else:
            im = im.convert("RGB")
        if im.width > WIDTH:
            im = im.resize((WIDTH, max(1, round(im.height * WIDTH / im.width))), Image.LANCZOS)
        tmp = dest + ".tmp"
        im.save(tmp, "WEBP", quality=QUALITY, method=6)
        os.replace(tmp, dest)
        with lock: stat["ok"] += 1
    except Exception as e:
        with lock: stat["fail"] += 1
        print("  falhou: %s (%s)" % (gid, e), flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    items = sorted(EXTRA_IMAGES.items())
    print("imagens extras a processar: %d" % len(items))
    t0 = time.time()
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(work, items))
    print("\nbaixadas %d | ja existiam %d | falhas %d  (%.0fs)" %
          (stat["ok"], stat["skip"], stat["fail"], time.time() - t0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
