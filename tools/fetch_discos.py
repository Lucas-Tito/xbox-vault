#!/usr/bin/env python3
"""Numero de discos e formato da midia, do datfile do Redump.

O catalogo nao dizia quantos discos um jogo ocupa. Sao cerca de 190 jogos
multidisco no Xbox 360, e para quem lida com midia fisica isso muda a decisao.

O Redump marca a contagem no proprio nome da entrada:

    Lost Odyssey (USA, Europe) (En,Ja,Fr,De,Es,It) (Disc 1)
    Lost Odyssey (USA, Europe) (En,Ja,Fr,De,Es,It) (Disc 2)

CUIDADO AO CONTAR: o Redump guarda varios dumps do mesmo disco, entao contar
linhas infla. Assassin's Creed III aparece 4 vezes e sao 2 discos. O certo e o
MAIOR N de "(Disc N)", nunca a soma de ocorrencias.

Sai tambem o formato da midia, que vem do tamanho da imagem: XGD2 ocupa 7,3 GB e
XGD3 ocupa 8,15 GB. Esse e o unico uso bom do tamanho do Redump -- como numero
de tamanho ele nao presta, porque e a imagem com padding e 98% dos jogos caem
nesses dois valores. O tamanho de download real vem do Marketplace, em
data/tamanho.json.

Validacao cruzada ja feita: todo jogo com download acima de 9 GB e multidisco
aqui, e a razao download/discos cai entre 4 e 7,5 GB em todos os casos.
"""
import json, os, re, sys, tempfile, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
XGD2, XGD3 = 7.30, 8.14          # GB, capacidade dos dois formatos de disco


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


def titulo_base(nome):
    """Tira o que o Redump anexa: disco, regiao, idioma, versao, edicao."""
    nome = re.sub(r"\s*\(Disc \d+\).*$", "", nome)
    nome = re.sub(r"\s*\((USA|Europe|Japan|World|Asia|Australia|Korea|Brazil|"
                  r"Germany|France|Spain|Italy|Russia|China|Taiwan)[^)]*\)", "", nome, flags=re.I)
    nome = re.sub(r"\s*\((En|Ja|Fr|De|Es|It|Pt|Nl|Sv|No|Da|Fi|Pl|Ru|Ko|Zh)[,)][^)]*\)?", "", nome)
    nome = re.sub(r"\s*\((Rev \d+|v[\d.]+|Beta|Demo|Alt|Proto)[^)]*\)", "", nome, flags=re.I)
    return re.sub(r"\s+", " ", nome).strip()


# Disco de revista e atualizacao de sistema nao sao jogo e nunca casam: filtrar
# antes evita que virem ruido na contagem de "sem par".
LIXO = re.compile(r"magazin|magazine|demo disk|demo disc|game disc|dashboard|"
                  r"system update|xbox live", re.I)


def casar(base, exato, prefixos):
    """Titulo do Redump -> id nosso. Exato primeiro, depois prefixo UNICO.

    O Redump escreve "Kameo - Elements of Power" e "Tiger Woods PGA Tour 12"
    onde o catalogo tem "Kameo: Elements of Power" e "... 12: The Masters". O
    prefixo so vale com um candidato: ambiguo e melhor descartar.
    """
    i = exato.get(base)
    if i:
        return i
    if len(base) < 6:
        return None
    cand = [x for k, x in prefixos if k.startswith(base) and len(k) <= len(base) + 24]
    return cand[0] if len(cand) == 1 else None


def salvar(caminho, obj):
    d = os.path.dirname(caminho)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=0, sort_keys=True)
            f.flush(); os.fsync(f.fileno())
        os.replace(tmp, caminho)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    dat = sys.argv[1] if len(sys.argv) > 1 else None
    if not dat or not os.path.exists(dat):
        print("uso: fetch_discos.py <caminho do .dat do Redump>")
        print("     baixe em http://redump.org/datfile/xbox360/ e descompacte")
        return 2
    texto = open(dat, encoding="utf-8", errors="replace").read()

    jogos = {}
    for m in re.finditer(r'<game name="([^"]+)"', texto):
        nome = m.group(1)
        base = titulo_base(nome)
        d = re.search(r"\(Disc (\d+)\)", nome)
        n = int(d.group(1)) if d else 1
        # tamanho da PRIMEIRA rom da entrada, para deduzir o formato do disco
        bloco = texto[m.end():m.end() + 900]
        t = re.search(r'<rom name="[^"]+" size="(\d+)"', bloco)
        gb = int(t.group(1)) / 1073741824 if t else 0
        e = jogos.setdefault(norm(base), {"titulo": base, "discos": 0, "gb": 0})
        e["discos"] = max(e["discos"], n)     # maior N, nunca soma
        e["gb"] = max(e["gb"], gb)
    print("entradas no datfile: %d | jogos distintos: %d"
          % (len(re.findall(r'<game name="', texto)), len(jogos)))
    multi = [v for v in jogos.values() if v["discos"] > 1]
    print("multidisco: %d" % len(multi))

    cat = json.load(open(os.path.join(ROOT, "data", "x360.json"), encoding="utf-8"))
    exato = {}
    for g in cat:
        exato.setdefault(norm(g["title"]), g["id"])
    prefixos = sorted(((norm(g["title"]), g["id"]) for g in cat), key=lambda x: len(x[0]))

    out, sem_par, descartados = {}, 0, 0
    for chave, v in jogos.items():
        if LIXO.search(v["titulo"]):
            descartados += 1
            continue
        i = casar(chave, exato, prefixos)
        if not i:
            sem_par += 1
            continue
        reg = {"discos": v["discos"]}
        if v["gb"]:
            reg["midia"] = "XGD3" if v["gb"] > (XGD2 + XGD3) / 2 else "XGD2"
        out[i] = reg
    salvar(os.path.join(ROOT, "data", "discos.json"), out)
    print("casaram com o catalogo: %d (%d sem par, %d discos de revista/sistema)"
          % (len(out), sem_par, descartados))
    print("  destes, multidisco: %d" % sum(1 for v in out.values() if v["discos"] > 1))
    import collections
    print("  por midia:", dict(collections.Counter(v.get("midia") for v in out.values())))
    print("-> data/discos.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
