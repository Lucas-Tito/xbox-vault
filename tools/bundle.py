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
            "maxPlayers", "confidence", "source"]


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


def main():
    games, missing = [], []
    for fn, label in [("x360.json", "Xbox 360"), ("xbox.json", "Xbox original"),
                      ("homebrew.json", "Homebrew")]:
        lst = load(fn, [])
        if not lst:
            missing.append(label)
        print("  %-16s %5d" % (label, len(lst)))
        games.extend(lst)

    tags = {}
    for fn in ["tags-x360.json", "tags-xbox.json", "tags-homebrew.json"]:
        t = load(fn, {})
        if isinstance(t, list):  # tolera array de {id: ...}
            t = {x["id"]: x for x in t if "id" in x}
        tags.update(t)
    print("  %-16s %5d" % ("tags", len(tags)))

    seen, dupes, tagged, imaged, localed, wide = set(), 0, 0, 0, 0, 0
    for g in games:
        if g["id"] in seen:
            dupes += 1
        seen.add(g["id"])
        t = tags.get(g["id"]) or {}
        if t:
            tagged += 1
        remote = norm_image(t.get("image") or g.get("image"))
        local = os.path.join(D, "..", "images", g["id"] + ".webp")
        g.pop("imageRemote", None)
        g.pop("wide", None)
        if os.path.exists(local) and os.path.getsize(local) > 0:
            # capa versionada no repo: nao depende do upload.wikimedia.org
            g["image"] = "images/" + g["id"] + ".webp"
            if remote:
                g["imageRemote"] = remote          # reserva se o arquivo faltar
            # nem toda "capa" e box art: ~250 artigos usam logo/faixa horizontal.
            # Ampliar isso num card 3/4 fica ilegivel, entao marcamos para o site
            # exibir inteiro em vez de cortar.
            if Image:
                try:
                    w, h = Image.open(local).size
                    if h and w / h > 1.2:
                        g["wide"] = True
                        wide += 1
                except Exception:
                    pass
            imaged += 1
            localed += 1
        elif remote:
            g["image"] = remote
            imaged += 1
        elif "image" in g:
            g["image"] = None
        g["tags"] = {k: t[k] for k in TAG_KEYS if t.get(k) not in (None, False, "")}

    payload = {
        "generated": datetime.datetime.now().isoformat(timespec="seconds"),
        "counts": {"total": len(games), "tagged": tagged, "withImage": imaged,
                   "withLocalImage": localed, "wideImage": wide},
        "games": games,
    }
    out = os.path.join(D, "db.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write("/* gerado por tools/bundle.py -- nao editar a mao */\n")
        f.write("window.XBX_DB=")
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")

    print("\n  total %d jogos | %d com tags | %d com imagem (%d locais, %d em paisagem) | "
          "%d ids duplicados" % (len(games), tagged, imaged, localed, wide, dupes))
    print("  -> data/db.js (%.1f MB)" % (os.path.getsize(out) / 1048576))
    if missing:
        print("  AVISO: sem dados de: %s" % ", ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
