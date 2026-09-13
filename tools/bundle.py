#!/usr/bin/env python3
"""Junta os JSONs de data/ num unico data/db.js que o site carrega via <script>.

Fontes de lista : data/x360.json, data/xbox.json, data/homebrew.json
Fontes de tags  : data/tags-x360.json, data/tags-xbox.json, data/tags-homebrew.json
                  (objetos { "<id>": {image, singlePlayer, coop, maxPlayers...} })

Usar <script> em vez de fetch() faz o site abrir direto do arquivo (file://),
sem precisar de servidor -- fetch de JSON local e bloqueado por CORS.
"""
import json, os, sys, datetime

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "data")

TAG_KEYS = ["singlePlayer", "multiplayerLocal", "multiplayerOnline", "coop", "coopLocal",
            "coopOnline", "versus", "versusLocal", "maxPlayersLocal", "maxPlayersOnline",
            "maxPlayers", "coopLocalMax", "coopOnlineMax", "coopSource",
            "confidence", "source"]


def aplicar_coop(g, t, co):
    """Sobrepoe o co-op com o dado do Co-Optimus, que e catalogado a mao.

    Regra: o Co-Optimus manda no que ele cobre, e nao encosta no resto. Ele so
    cataloga co-op -- nao tem versus, nem single player, nem contagem total de
    jogadores -- entao nada que venha de outra fonte pode ser apagado por ele.

    Na pratica isso quer dizer:
      - uma dimensao (local/online) so e sobrescrita se o Co-Optimus falar dela;
        calado sobre ela, fica o que o catalogo ja tinha;
      - os numeros deles sao de CO-OP e vao para campos proprios. maxPlayers*
        e do jogo inteiro (Halo 3: 4 em co-op, 16 em versus), entao so SOBE;
      - "coop" tambem conta combo e LAN, senao um jogo cujo co-op e so por
        system link viraria "sem co-op";
      - source/confidence descrevem as tags que vieram de outra fonte e ficam
        como estao; a procedencia do co-op vai em coopSource.
    """
    dito = {k: co[k] for k in ("local", "online", "combo", "lan")
            if isinstance(co.get(k), int)}
    if not dito or not any(v > 0 for v in dito.values()):
        # nada aproveitavel: o Co-Optimus so lista jogo COM co-op, entao tudo
        # zerado e sinal de leitura incompleta, nao de ausencia de co-op
        return False

    cabo = dito.get("lan", 0) > 0 and g.get("platform") == "emu"
    if "local" in dito and not cabo:
        t["coopLocal"] = dito["local"] > 0
        if dito["local"] > 0:
            t["coopLocalMax"] = dito["local"]
            t["multiplayerLocal"] = True
            t["maxPlayersLocal"] = max(t.get("maxPlayersLocal") or 0, dito["local"])
    if "online" in dito:
        t["coopOnline"] = dito["online"] > 0
        if dito["online"] > 0:
            t["coopOnlineMax"] = dito["online"]
            t["multiplayerOnline"] = True
            t["maxPlayersOnline"] = max(t.get("maxPlayersOnline") or 0, dito["online"])
    if dito.get("lan", 0) > 0:
        # System Link num cartucho de GBA/SNES/PS1 e cabo link, ou seja, co-op
        # LOCAL. O Co-Optimus cataloga esses jogos como "LAN or System Link" e
        # marca "Local Co-Op: Not Supported" -- tratar isso como online
        # anunciaria um cartucho de Game Boy como jogo pela internet.
        if g.get("platform") == "emu":
            t["coopLocal"] = True
            t["multiplayerLocal"] = True
            t["coopLocalMax"] = max(t.get("coopLocalMax") or 0, dito["lan"])
            t["maxPlayersLocal"] = max(t.get("maxPlayersLocal") or 0, dito["lan"])
        else:
            t["multiplayerOnline"] = True
            t["maxPlayersOnline"] = max(t.get("maxPlayersOnline") or 0, dito["lan"])

    t["coop"] = True
    # nunca abaixa: o total pode vir de versus, que o Co-Optimus desconhece
    t["maxPlayers"] = max(t.get("maxPlayers") or 0,
                          t.get("maxPlayersLocal") or 0,
                          t.get("maxPlayersOnline") or 0)
    t["coopSource"] = "co-optimus"

    info = {"fonte": co["fonte"], "snapshot": co["snapshot"]}
    for k in ("local", "online", "combo", "lan", "extras", "exp"):
        if co.get(k) not in (None, [], ""):
            info[k] = co[k]
    g["coopInfo"] = info
    return True


def norm_image(url):
    """Normaliza URL de capa: tira os ?utm_* que a API anexa e usa o host canonico.
    Os dois hosts respondem 200, mas manter um formato so evita URL suja no JSON."""
    if not url or not url.startswith("http"):
        return None
    url = url.split("?")[0]
    return url.replace("https://thumb.wikimedia.org/", "https://upload.wikimedia.org/")


def load(name, default):
    p = os.path.join(D, name)
    if not os.path.exists(p):
        print("  ! ausente: data/%s" % name)
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def montar(lista_arquivos, tag_arquivos, rotulo, extras=None):
    """Junta listas + tags e devolve os jogos prontos, com capa local quando existir."""
    games = []
    for fn, label in lista_arquivos:
        lst = load(fn, [])
        print("  %-16s %5d" % (label, len(lst)))
        games.extend(lst)
    notas = {}
    for arq in ("metacritic.json", "metacritic-indies.json", "metacritic-emu.json"):
        notas.update(load(arq, {}))
    tags = {}
    for fn in tag_arquivos:
        t = load(fn, {})
        if isinstance(t, list):
            t = {x["id"]: x for x in t if "id" in x}
        tags.update(t)
    # jogos cancelados que ficaram prontos e vazaram: entram pela curadoria manual
    # de data/vazados.json, com as tags escritas a mao junto da entrada.
    for g in (extras or []):
        t = g.pop("tags", None)
        if t:
            tags[g["id"]] = t
        games.append(g)
    if extras:
        print("  %-16s %5d" % ("vazados", len(extras)))
    print("  %-16s %5d" % ("tags", len(tags)))

    coop = load("coop.json", {})
    # nota dos jogadores do Marketplace: entra ao lado da nota da critica,
    # nunca no lugar dela
    x360db = load("x360db.json", {})
    screens = load("screens.json", {})
    tus = load("tu.json", {})
    # tempo de jogo e curadoria manual: ver o cabecalho de data/tempo.json
    tempos = load("tempo.json", {}).get("jogos", {})
    seen, dupes, tagged, imaged, localed, wide, coopados = set(), 0, 0, 0, 0, 0, 0
    for g in games:
        if g["id"] in seen:
            dupes += 1
        seen.add(g["id"])
        t = tags.get(g["id"]) or {}
        if t:
            tagged += 1
        remote = norm_image(t.get("image") or g.get("image"))
        local = os.path.join(D, "..", "images", g["id"] + ".webp")
        g.pop("imageRemote", None); g.pop("wide", None)
        g.pop("iaCover", None); g.pop("lbFile", None)   # campos internos de build
        if os.path.exists(local) and os.path.getsize(local) > 0:
            g["image"] = "images/" + g["id"] + ".webp"
            if Image:
                try:
                    w, h = Image.open(local).size
                    if h and w / h > 1.2:
                        g["wide"] = True; wide += 1
                except Exception:
                    pass
            imaged += 1; localed += 1
        elif remote:
            # Sem arquivo local, o card cai no placeholder. Guardar a URL remota
            # faria o site buscar imagem em servidor de terceiro -- o catalogo e
            # para funcionar inteiro a partir do proprio repositorio.
            g["image"] = None
        elif "image" in g:
            g["image"] = None
        g.pop("coopInfo", None)
        co = coop.get(g["id"])
        if co and not co.get("sem_dado"):
            t = dict(t)
            if aplicar_coop(g, t, co):
                coopados += 1
        g["tags"] = {k: t[k] for k in TAG_KEYS if t.get(k) not in (None, False, "")}
        g.pop("ur", None); g.pop("titleId", None); g.pop("screens", None)
        g.pop("tu", None); g.pop("tempo", None)
        tp = tempos.get(g["id"])
        if tp and any(isinstance(tp.get(k), (int, float)) for k in ("main", "plus", "cem")):
            g["tempo"] = tp
        t_u = tus.get(g["id"])
        if t_u is not None:
            # n=0 tambem vale: sabemos que consultamos e o jogo nao teve patch
            g["tu"] = {k: v for k, v in t_u.items() if v not in (None, 0)} or {"n": 0}
        ns = screens.get(g["id"])
        if isinstance(ns, int) and ns > 0:
            g["screens"] = ns
        r = x360db.get(g["id"])
        if r:
            if isinstance(r.get("ur"), (int, float)):
                g["ur"] = r["ur"]           # 0 a 5, media dos jogadores
            if r.get("titleId"):
                g["titleId"] = r["titleId"]
            # so preenche buraco: o que a Wikipedia ja trouxe tem preferencia
            if r.get("dev") and not (g.get("developers") or []):
                g["developers"] = [x.strip() for x in r["dev"].split("/") if x.strip()]
            if r.get("pub") and not (g.get("publishers") or []):
                g["publishers"] = [x.strip() for x in r["pub"].split("/") if x.strip()]
        n = notas.get(g["id"])
        g.pop("mcGeral", None); g.pop("mcPlats", None)
        if n and isinstance(n.get("score"), int):
            g["mc"] = n["score"]
            if n.get("geral"):
                # nota que NAO e da plataforma do jogo: o site avisa no popup.
                # A lista de plataformas continua em metacritic*.json ("plats"),
                # mas nao vai para o db.js: o aviso do popup nao usa mais.
                g["mcGeral"] = True
        else:
            g.pop("mc", None)
    com_mc = sum(1 for g in games if g.get("mc"))
    com_ur = sum(1 for g in games if g.get("ur"))
    com_tu = sum(1 for g in games if (g.get("tu") or {}).get("n"))
    com_tempo = sum(1 for g in games if g.get("tempo"))
    so_ur = sum(1 for g in games if g.get("ur") and not g.get("mc"))
    print("  %s: %d jogos | %d com tags | %d com imagem (%d locais, %d paisagem) | "
          "%d com Metacritic | %d com nota de jogador (%d so essa) | "
          "%d com patch | %d com tempo | %d co-op do Co-Optimus | %d dup" %
          (rotulo, len(games), tagged, imaged, localed, wide, com_mc, com_ur, so_ur,
           com_tu, com_tempo, coopados, dupes))
    return games, {"total": len(games), "tagged": tagged, "withImage": imaged,
                   "withLocalImage": localed, "wideImage": wide}


def escrever(caminho, variavel, payload):
    out = os.path.join(D, caminho)
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* gerado por tools/bundle.py -- nao editar a mao */\n")
        f.write("window.%s=" % variavel)
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("  -> data/%s (%.1f MB)" % (caminho, os.path.getsize(out) / 1048576))


def main():
    print("== catalogo principal ==")
    games, counts = montar(
        [("x360.json", "Xbox 360"), ("xblig.json", "Indie (XBLIG)"),
         ("xbox.json", "Xbox original"), ("homebrew.json", "Homebrew")],
        ["tags-x360.json", "tags-xblig.json", "tags-xbox.json", "tags-homebrew.json"],
        "principal", extras=load("vazados.json", {}).get("catalogo", []))
    escrever("db.js", "XBX_DB", {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "counts": counts, "games": games})

    # Emulacao vai num arquivo separado: a categoria vem desligada e o site so
    # baixa este arquivo se o usuario ligar. Quem nunca ligar nao paga o peso.
    print("\n== emulacao (carregada sob demanda) ==")
    emu, ec = montar([("emu.json", "SNES/GBA/PS1")], ["tags-emu.json"], "emulacao")
    if emu:
        escrever("db-emu.js", "XBX_EMU", {
            "generated": datetime.datetime.now().isoformat(timespec="seconds"),
            "counts": ec, "games": emu})
    return 0


if __name__ == "__main__":
    sys.exit(main())
