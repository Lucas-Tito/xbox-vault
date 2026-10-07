"""Casamento de nome de jogo entre uma base de Title IDs e o catálogo.

As bases de Title ID (o x360db, do Marketplace, e o xdb, do xemu) escrevem o
nome do jeito curto da loja ou do disco: "GTA IV", "Sonics UGC", "Army of TWO
TFD", "SplinterCellConviction". O catálogo usa o nome da Wikipédia. Por isso
há duas passadas:

1. nome igual depois de normalizar (caixa, acento, pontuação, & = and);
2. para o que sobrou, um casamento TOLERANTE: todo termo do nome curto tem que
   aparecer no nome do catálogo, como palavra, como começo de palavra ou como
   sigla das iniciais ("GTA" = Grand Theft Auto); algarismo romano vale o
   arábico; marca solta ("Disney", "EA Sports", "Tom Clancy's") não conta.

A passada 2 só aceita casamento sem disputa: um candidato só no catálogo para
a entrada, e uma entrada só da base para o jogo. Na dúvida, fica de fora; jogo
sem Title ID é melhor que Title ID de outro jogo.
"""
import collections
import re
import unicodedata

ROMANO = {"ii": "2", "iii": "3", "iv": "4", "v": "5", "vi": "6", "vii": "7",
          "viii": "8", "ix": "9", "x": "10"}
# Palavras que a loja acrescenta ou tira do nome sem mudar o jogo.
SOLTAS = {"disney", "ea", "sports", "tom", "clancys", "full", "version", "the",
          "and", "of", "a", "edition"}


def _limpa(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("'", "").replace("’", "")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", _limpa(s).lower().replace("&", "and"))


def termos(s):
    # "SplinterCellConviction" vira tres termos: a base cola palavras as vezes
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", _limpa(s))
    t = [w.lower() for w in re.split(r"[^A-Za-z0-9]+", s.replace("&", " and ")) if w]
    return [ROMANO.get(w, w) for w in t]


def explica(curto, longo):
    """O nome curto (lista de termos) cabe inteiro no nome longo?"""
    uteis = [t for t in curto if t not in SOLTAS]
    if not uteis:
        return False
    iniciais = "".join(t[0] for t in longo)
    for t in uteis:
        if t in longo:
            continue
        # comeco de palavra so com dois termos ou mais: "Bomber" sozinho casaria
        # com "Bomberman Live: Battlefest"
        if len(uteis) > 1 and len(t) >= 3 and any(u.startswith(t) for u in longo):
            continue
        if len(t) >= 2 and not t.isdigit() and t in iniciais:
            continue
        return False
    # numero e o que separa sequencia: "Vegas 2" nao e "Vegas". Se o curto tem
    # numero, o longo tem que ter os mesmos. Se nao tem, o longo so pode ter ANO
    # a mais ("PDC World Champ Darts" e o "PDC World Championship Darts 2008"),
    # nunca numero de sequencia.
    nc = {t for t in curto if t.isdigit()}
    nl = {t for t in longo if t.isdigit()}
    if nc:
        return nc == nl
    return all(int(n) >= 1900 for n in nl)


def casar(entradas, catalogo, ano_max=None):
    """entradas: [(chave, nome)] da base; catalogo: [(id, nome, ano)].

    Devolve {id_do_catalogo: ([chaves], "nome" | "aprox")}. Pelo nome igual,
    um jogo pode levar varias entradas: sao as repeticoes por regiao, e cada
    uma e um Title ID valido do mesmo jogo. ano_max(chave), se vier, e o ano da
    entrada: jogo do catalogo MAIS NOVO que ela fica de fora, porque relancamento
    vem depois do original, nunca antes.
    """
    por_nome = {}
    for i, nome, _ in catalogo:
        por_nome.setdefault(norm(nome), i)
    feito, sobra = {}, []
    for chave, nome in entradas:
        i = por_nome.get(norm(nome))
        if i:
            feito.setdefault(i, ([], "nome"))[0].append(chave)
        else:
            sobra.append((chave, nome))

    # A ambiguidade se mede no catalogo INTEIRO, e nao so entre os que ainda
    # nao tem Title ID: "Tom Clancys Splinter Cell" serve para tres jogos da
    # serie, e nao pode virar o Conviction so porque os outros dois ja casaram.
    todos = [(i, termos(n), a) for i, n, a in catalogo]
    propostas = collections.defaultdict(list)
    for chave, nome in sobra:
        curto = termos(nome)
        teto = ano_max(chave) if ano_max else None
        cands = [i for i, longo, a in todos
                 if not (teto and a and a > teto) and explica(curto, longo)]
        if len(cands) == 1 and cands[0] not in feito:
            propostas[cands[0]].append(chave)
    for i, chaves in propostas.items():
        if len(chaves) == 1:          # duas entradas disputando o mesmo jogo: nenhuma
            feito[i] = (chaves, "aprox")
    return feito
