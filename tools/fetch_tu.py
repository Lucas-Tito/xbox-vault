#!/usr/bin/env python3
"""Title Updates (patches) do Xbox 360, da base comunitaria do Xbox Unity.

O Xbox Unity mantem um arquivo dos updates oficiais que a Microsoft distribuia
pela Xbox LIVE. Como a LIVE do 360 foi desligada, essa e a memoria de que patch
existiu para cada jogo -- informacao que nao esta na Wikipedia nem no x360db.

A consulta e por Title ID, que ja temos em data/x360db.json para 4.892 jogos, e
a API e aberta: TitleUpdateInfo.php?titleid=<TID> devolve JSON.

A resposta traz uma lista por MediaID (cada prensagem/regiao do disco tem a sua)
e, dentro de cada uma, os updates com versao, tamanho em KB, data e hash. O que
guardamos por jogo e o resumo: quantos updates existem, a maior versao e a data
do mais recente -- o detalhe por media interessa a quem vai aplicar o patch, nao
a quem esta olhando o catalogo.

Resumivel e idempotente.
"""
import json, os, socket, sys, time, urllib.error, urllib.request

# O xboxunity.net publica um AAAA que nem toda rede alcanca. O curl tem happy
# eyeballs e cai para IPv4 na hora; o urllib tenta o IPv6 e fica pendurado ate o
# timeout inteiro -- 15 consultas passavam de dois minutos sem sair do lugar.
_getaddrinfo = socket.getaddrinfo
socket.getaddrinfo = lambda *a, **k: [x for x in _getaddrinfo(*a, **k)
                                      if x[0] == socket.AF_INET]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "http://xboxunity.net/Resources/Lib/TitleUpdateInfo.php?titleid=%s"
UA = "Mozilla/5.0 XbxVault/1.0 (catalogo pessoal; lucassga500@gmail.com)"
PAUSA = 0.5


def baixar(url, tries=3):
    delay = 2.0
    for n in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 400) or n == tries - 1:
                return None
            time.sleep(delay); delay *= 2
        except Exception:
            if n == tries - 1:
                return None
            time.sleep(delay); delay *= 1.7
    return None


def resumo(bruto):
    """Condensa a resposta do Unity no que interessa ao catalogo."""
    try:
        d = json.loads(bruto)
    except ValueError:
        return None
    medias = d.get("MediaIDS") or []
    updates = []
    for m in medias:
        for u in (m.get("Updates") or []):
            try:
                v = int(u.get("Version") or 0)
            except ValueError:
                v = 0
            try:
                kb = int(u.get("Size") or 0)
            except ValueError:
                kb = 0
            updates.append((v, kb, (u.get("UploadDate") or "")[:10]))
    if not updates:
        return None
    # o mesmo update aparece repetido por media; contar versoes distintas
    versoes = sorted({v for v, _, _ in updates if v})
    datas = sorted(d for _, _, d in updates if d)
    return {
        "n": len(versoes) or len(updates),      # quantos patches distintos
        "ultima": versoes[-1] if versoes else None,
        "data": datas[-1] if datas else None,
        "kb": max((kb for _, kb, _ in updates), default=0),
        "medias": len(medias),
    }


def main():
    with open(os.path.join(ROOT, "data", "x360db.json"), encoding="utf-8") as f:
        base = json.load(f)
    itens = [(gid, v["titleId"]) for gid, v in sorted(base.items()) if v.get("titleId")]
    limite = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    if limite:
        itens = itens[:limite]

    saida = os.path.join(ROOT, "data", "tu.json")
    dados = {}
    if os.path.exists(saida) and "--refazer" not in sys.argv:
        with open(saida, encoding="utf-8") as f:
            dados = json.load(f)

    fila = [i for i in itens if i[0] not in dados]
    print("jogos com Title ID: %d | ja consultados: %d | na fila: %d"
          % (len(itens), len(dados), len(fila)))

    com, sem, erro = 0, 0, 0
    t0 = time.time()
    for i, (gid, tid) in enumerate(fila, 1):
        bruto = baixar(API % tid)
        time.sleep(PAUSA)
        if bruto is None:
            erro += 1
            continue                 # nao grava: falha de rede volta na proxima
        r = resumo(bruto)
        if r:
            dados[gid] = r; com += 1
        else:
            dados[gid] = {"n": 0}    # consultado e nao tem patch nenhum
            sem += 1
        if i % 100 == 0 or i == len(fila):
            with open(saida, "w", encoding="utf-8") as f:
                json.dump(dados, f, ensure_ascii=False, indent=0, sort_keys=True)
            print("  %d/%d  com patch=%d sem=%d erro=%d  %.0f min"
                  % (i, len(fila), com, sem, erro, (time.time() - t0) / 60), flush=True)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=0, sort_keys=True)
    print("\ndata/tu.json: %d jogos (%d com patch)"
          % (len(dados), sum(1 for v in dados.values() if v.get("n"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
