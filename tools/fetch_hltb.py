#!/usr/bin/env python3
"""Tempo de jogo do HowLongToBeat, que e o unico lugar onde esse numero existe.

Quanto tempo um jogo leva nao esta na Wikipedia, nao esta no x360db e nao esta
no Metacritic: e um dado que so existe porque milhares de jogadores anotaram o
proprio tempo. O HowLongToBeat agrega esses relatos em tres medidas, que sao
exatamente as tres que data/tempo.json ja previa:

  comp_main -> main  so a historia principal
  comp_plus -> plus  principal + conteudo secundario
  comp_100  -> cem   completar 100%

Vem em SEGUNDOS e sao gravados aqui em horas decimais, no mesmo formato do
tempo.json, para os dois arquivos poderem ser lidos lado a lado.

O NUMERO E O DA NOSSA PLATAFORMA, e essa e a licao mais cara deste coletor.

A busca devolve UM numero por jogo, somando todas as versoes. Isso mente quando
a nossa difere: Black Ops III no Xbox 360 nao tem campanha nenhuma, e o agregado
anunciava 9h de historia principal apoiado em 635 relatos -- de quem jogou no PC,
PS4 e One. Nem e so caso patologico: ate no Halo 3, que saiu igual em todo lugar,
o agregado da 7,7h porque o PC puxa para baixo, e a versao de Xbox 360 da 9,1h.

A quebra por plataforma existe, so nao vem na busca: esta no __NEXT_DATA__ da
pagina do jogo, em "platformData". Por isso cada jogo que casa custa DUAS
requisicoes -- a busca, que acha o id, e a pagina, que da o numero certo.

Sem linha da nossa plataforma, o agregado e usado como reserva e o registro fica
marcado via="geral", para o site avisar. E o mesmo tratamento que o catalogo ja
da a nota do Metacritic que nao e da nossa plataforma.

A CONTAGEM DE RELATOS E METADE DO DADO. Portal 2 tem milhares e a media vale; o
Black Ops III de Xbox 360 tem 5, e 5 relatos de um jogo sem campanha e ruido que
a interface precisa poder sinalizar. Por isso "n" nunca e descartado. E um
inteiro so por entrada, nao um por medida: a linha de plataforma do site nao tem
contagem por medida, e deixar as duas formas convivendo obrigaria a interface a
adivinhar qual esta lendo.

COMO A CONSULTA FUNCIONA

A busca do site e um POST para /api/search/site, e ele exige tres cabecalhos que
saem de /api/search/site/init -- um token e um par chave/valor de armadilha. O
init e aberto: nao pede conta, nao pede senha, devolve para qualquer um que
peca. O token e base64 de "<timestamp>::<ip>|<user-agent>|<chave>|<valor>.<hmac>",
ou seja, esta amarrado ao IP E AO USER-AGENT de quem pediu: o mesmo UA tem de ir
no init e na busca, senao a busca volta 403. Ele tambem vence com o tempo, e a
recuperacao e a mesma que o site faz -- pedir outro e repetir a consulta.

O UA e o do projeto, com endereco de contato, igual ao dos outros coletores. Foi
testado: o site responde igual sem precisar fingir ser um navegador.

DUAS COISAS QUE FAZEM O DADO SAIR ERRADO SE FOREM IGNORADAS

1. O "size" do POST e limitado a 20 no servidor. Pedir 40 ou 100 nao devolve
   erro: devolve {} -- um objeto vazio, sem "data" e sem "count". Quem nao
   confere isso le zero resultado e conclui que o jogo nao existe no site.

2. O ano do HowLongToBeat e o do lancamento MUNDIAL, e o nosso costuma ser o da
   versao que catalogamos. Crysis e 2007 la e 2011 aqui, porque o que temos e a
   porta de Xbox 360. Por isso o ano NAO reprova um casamento -- ele so desempata
   entre dois titulos iguais. Quem usa ano como filtro perde toda porta tardia.

O casamento exige titulo normalizado identico (ao "game_name" ou ao "game_alias")
E a nossa plataforma presente no "profile_platform" da entrada. Titulo parecido
nao serve: "Halo: Combat Evolved" e "Halo: Combat Evolved - Anniversary" sao dois
jogos com tempos diferentes.

Cada alvo grava no SEU arquivo, pelo mesmo motivo do fill_metacritic.py: dois
processos em paralelo carregam o JSON inteiro na memoria e reescrevem tudo a cada
checkpoint, entao um arquivo unico faria um apagar o trabalho do outro.

Nunca escreve em data/tempo.json. Aquele arquivo e curadoria a mao e continua
mandando no que estiver la -- quem junta os dois e o bundle.py.

Resumivel e idempotente: rode de novo e ele continua de onde parou.

uso: fetch_hltb.py [xbox|indies|emu] [limite] [--refazer]
"""
import json, os, re, sys, tempfile, time, unicodedata, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://howlongtobeat.com"
UA = "XbxVault/1.0 (https://github.com/Lucas-Tito/xbox-vault; lucassga500@gmail.com)"
PAUSA = 1.5
SIZE = 20                  # o servidor recusa mais que isso (devolve {} vazio)
PAGINAS = 3                # so pagina quando a pagina 1 nao casou e ha mais
VALIDADE = 600             # renova o token antes de ele vencer, por garantia
VERSAO = 2                 # 2: tempo por PLATAFORMA em vez do agregado
POUCOS_RELATOS = 10        # mesmo corte do aviso no popup (app.js)

# Como a plataforma se chama la. O casamento exige que uma destas apareca no
# "profile_platform" da entrada -- e o que separa o Halo de Xbox do de PC.
PLAT = {"x360": "Xbox 360", "xbox": "Xbox",
        "SNES": "Super Nintendo", "PS1": "PlayStation", "GBA": "Game Boy Advance"}

ALVOS = {
    # rotulo: (arquivos de entrada, como sair da plataforma, arquivo de saida)
    "xbox":   ([("x360.json", "x360"), ("xbox.json", "xbox")], "hltb.json"),
    "indies": ([("xblig.json", "x360")], "hltb-indies.json"),
    "emu":    ([("emu.json", None)], "hltb-emu.json"),   # None = campo "system"
}


def norm(s):
    """Mesma normalizacao dos outros coletores: so letras e digitos."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("&", "and")
    return re.sub(r"[^a-z0-9]", "", s)


def termos(titulo):
    """Palavras da busca. A API junta os termos com E, entao pontuacao atrapalha:
    'Halo: Combat Evolved' tem de virar tres palavras limpas, nao 'Halo:'."""
    t = re.sub(r"[^\w\s]", " ", titulo or "", flags=re.UNICODE)
    return [p for p in t.split() if p][:12]


class Sessao:
    """Guarda o token da busca e o renova sozinho quando vence."""

    def __init__(self):
        self.tk = None
        self.nascimento = 0

    def token(self, forcar=False):
        if self.tk and not forcar and time.time() - self.nascimento < VALIDADE:
            return self.tk
        for n in range(4):
            try:
                req = urllib.request.Request(
                    "%s/api/search/site/init?t=%d" % (BASE, time.time() * 1000),
                    headers={"User-Agent": UA, "Referer": BASE + "/"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    d = json.loads(r.read().decode("utf-8", "replace"))
                if d.get("token"):
                    self.tk, self.nascimento = d, time.time()
                    return d
            except Exception:
                pass
            time.sleep(2.0 * (n + 1))
        return None

    def dados_do_jogo(self, game_id, tentativas=3):
        """platformData da pagina do jogo, ou None se nao deu para ler.

        A pagina e renderizada no servidor e traz um __NEXT_DATA__ com o tempo
        quebrado por plataforma -- o que a busca nao devolve. Nao precisa de
        token: e a pagina publica do jogo.

        Lista vazia e resposta valida (o jogo existe e ninguem relatou por
        plataforma); None e falha de leitura, que nao pode virar dado.
        """
        for n in range(tentativas):
            try:
                req = urllib.request.Request(
                    "%s/game/%s" % (BASE, game_id),
                    headers={"User-Agent": UA, "Referer": BASE + "/"})
                with urllib.request.urlopen(req, timeout=50) as r:
                    h = r.read().decode("utf-8", "replace")
                m = re.search(r'id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
                if not m:
                    return None
                d = json.loads(m.group(1))
                return (d.get("props", {}).get("pageProps", {})
                         .get("game", {}).get("data", {}).get("platformData") or [])
            except urllib.error.HTTPError as e:
                if e.code in (404, 410):
                    return []          # pagina sumiu: segue com o agregado
                if n == tentativas - 1:
                    return None
                time.sleep(3.0 * (n + 1))
            except Exception:
                if n == tentativas - 1:
                    return None
                time.sleep(3.0 * (n + 1))
        return None

    def buscar(self, palavras, pagina=1, tentativas=3):
        """Uma pagina de resultados, ou None se nao deu para consultar.

        Lista vazia e resposta valida ("procurei e nao tem"); None e falha de
        rede, que NAO pode ser gravada como ausencia -- senao um tropeco de
        conexao vira 'esse jogo nao existe no site' para sempre.
        """
        for n in range(tentativas):
            tk = self.token()
            if not tk:
                time.sleep(3.0)
                continue
            corpo = {
                "searchType": "games",
                "searchTerms": palavras,
                "searchPage": pagina,
                "size": SIZE,
                "searchOptions": {
                    "games": {"userId": 0, "platform": "", "sortCategory": "popular",
                              "rangeCategory": "main",
                              "rangeTime": {"min": None, "max": None},
                              "gameplay": {"perspective": "", "flow": "",
                                           "genre": "", "difficulty": ""},
                              "year": "", "modifier": ""},
                    "users": {"sortCategory": "postcount"},
                    "lists": {"sortCategory": "follows"},
                    "filter": "", "sort": 0, "randomizer": 0,
                },
                "useCache": True,
            }
            corpo[tk["hpKey"]] = tk["hpVal"]      # o par de armadilha vai tambem no corpo
            req = urllib.request.Request(
                BASE + "/api/search/site", data=json.dumps(corpo).encode("utf-8"),
                headers={"User-Agent": UA, "Content-Type": "application/json",
                         "Accept": "application/json", "Referer": BASE + "/",
                         "Origin": BASE, "x-auth-token": tk["token"],
                         "x-hp-key": tk["hpKey"], "x-hp-val": tk["hpVal"]})
            try:
                with urllib.request.urlopen(req, timeout=50) as r:
                    d = json.loads(r.read().decode("utf-8", "replace"))
                if "data" not in d:
                    return None      # resposta sem lista: nao e "nao achei"
                return d
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    self.token(forcar=True)      # token vencido: pega outro e repete
                    continue
                if e.code == 429:
                    time.sleep(30.0 * (n + 1))   # pediu calma: obedece
                    continue
                if n == tentativas - 1:
                    return None
                time.sleep(3.0 * (n + 1))
            except Exception:
                if n == tentativas - 1:
                    return None
                time.sleep(3.0 * (n + 1))
        return None


def por_plataforma(dados_pagina, plataforma):
    """A linha de platformData da NOSSA plataforma, ou None.

    E aqui que mora a correcao que motivou a versao 2. O numero da busca e UM SO
    para todas as versoes do jogo, e isso mente quando a nossa difere das outras:
    Black Ops III no Xbox 360 nao tem campanha nenhuma, e o agregado anunciava
    9h de historia principal apoiado em 635 relatos -- que sao de quem jogou no
    PC, PS4 e One. A linha do 360 diz 5 relatos, e 5 relatos a interface ja sabe
    sinalizar como amostra magra.

    Nao e so caso patologico: ate no Halo 3, que saiu igual em todo lugar, o
    agregado da 7,7h porque o PC puxa para baixo, e a linha de Xbox 360 da 9,1h.
    """
    alvo = PLAT.get(plataforma)
    for linha in (dados_pagina or []):
        if (linha.get("platform") or "").strip() == alvo:
            return linha
    return None


def horas(seg, conta):
    """Segundos -> horas decimais. So vale com relato: 0 relatos nao e 'zero
    hora', e ausencia de medida, e o site nao pode mostrar 0h como se fosse tempo."""
    try:
        seg, conta = int(seg or 0), int(conta or 0)
    except (TypeError, ValueError):
        return None
    if seg <= 0 or conta <= 0:
        return None
    return round(seg / 3600.0, 1)


def escolher(resultados, aceitos, plataforma, ano):
    """(entrada escolhida, houve titulo igual em outra plataforma).

    Exige titulo normalizado IDENTICO e a nossa plataforma presente. Entre as que
    passam: jogo antes de ROM hack, depois o maior numero de relatos, e o ano
    so entra como desempate final.

    O segundo valor existe para o descarte ser auditavel. Quando o titulo bate
    mas a plataforma nao, ha dois mundos possiveis -- e um jogo homonimo que nao
    e o nosso (rejeitar esta certo), ou e o nosso com a lista de plataformas
    incompleta la (rejeitar custou um acerto). Sao coisas diferentes e ficam
    gravadas com motivos diferentes, para dar para medir o tamanho de cada uma
    sem ter de rodar a coleta de novo.
    """
    alvo = PLAT.get(plataforma)
    if not alvo:
        return None, False
    candidatos, so_outra = [], False
    for c in resultados:
        if norm(c.get("game_name")) not in aceitos and norm(c.get("game_alias")) not in aceitos:
            continue
        # "Xbox" isolado nao pode casar dentro de "Xbox 360"/"Xbox One": a lista
        # vem separada por virgula, entao a comparacao e item a item.
        plats = [p.strip() for p in (c.get("profile_platform") or "").split(",")]
        if alvo not in plats:
            so_outra = True
            continue
        try:
            dist = abs(int(c.get("release_world") or 0) - int(ano)) if ano else 9
        except (TypeError, ValueError):
            dist = 9
        candidatos.append((c.get("game_type") == "game", int(c.get("comp_main_count") or 0),
                           -dist, c))
    if not candidatos:
        return None, so_outra
    candidatos.sort(key=lambda x: x[:3], reverse=True)
    return candidatos[0][3], so_outra


def consultar(ses, g, plataforma, contador):
    """(registro, motivo). registro=None quando nao casou; motivo diz por que."""
    titulo = g.get("title") or ""
    limpo = re.sub(r"\s*\([^)]*\)", "", titulo).strip()
    aceitos = {n for n in (norm(titulo), norm(limpo)) if n}
    tentativas = [termos(titulo)]
    if limpo and limpo != titulo and termos(limpo) != tentativas[0]:
        tentativas.append(termos(limpo))

    total, so_outra = 0, False    # maior "count" visto e se algum titulo bateu
    for palavras in tentativas:
        if not palavras:
            continue
        pagina = 1
        while pagina <= PAGINAS:
            d = ses.buscar(palavras, pagina)
            contador[0] += 1
            time.sleep(PAUSA)
            if d is None:
                return None, None          # falha de rede: nao grava nada
            total = max(total, d.get("count") or 0)
            achou, outra = escolher(d.get("data") or [], aceitos, plataforma, g.get("year"))
            so_outra = so_outra or outra
            if achou:
                return achou, None
            if pagina * SIZE >= total:
                break
            pagina += 1
    if so_outra:
        return None, "so-outra-plataforma"
    return None, ("sem-resultado" if not total else "nenhum-casou")


MEDIDAS = (("main", "comp_main"), ("plus", "comp_plus"), ("cem", "comp_100"))


def registro(c, linha, plataforma):
    """O que fica gravado por jogo, preferindo o numero da NOSSA plataforma.

    "n" e um inteiro so -- quantos relatos sustentam a entrada -- e nao mais um
    por medida. A linha de plataforma do site nao traz contagem por medida, traz
    uma so (count_comp); deixar as duas formas convivendo obrigaria a interface a
    adivinhar qual delas esta lendo.

    Sem linha propria sobra o agregado, que soma todas as versoes. Ele nao e
    descartado -- para a maioria dos jogos as versoes sao equivalentes e o numero
    serve -- mas fica marcado "geral", e o site avisa. E o mesmo tratamento que o
    catalogo ja da a nota do Metacritic que nao e da nossa plataforma.
    """
    r = {}
    if linha:
        for nosso, campo in MEDIDAS:
            v = horas(linha.get(campo), linha.get("count_comp"))
            if v is not None:
                r[nosso] = v
    if r:
        via, n = "plataforma", int(linha.get("count_comp") or 0)
    else:
        for nosso, campo in MEDIDAS:
            v = horas(c.get(campo), c.get(campo + "_count"))
            if v is not None:
                r[nosso] = v
        if not r:
            return None
        via = "geral"
        n = max(int(c.get(campo + "_count") or 0) for nosso, campo in MEDIDAS if nosso in r)
    r["n"] = n
    r["via"] = via
    r["hltb"] = c.get("game_id")
    r["nome"] = c.get("game_name")
    if c.get("release_world"):
        r["ano"] = c["release_world"]
    r["v"] = VERSAO
    return r


def relatos(reg):
    """Quantos relatos sustentam um registro, tolerando as DUAS formas de "n".

    A versao 1 gravava um dicionario por medida e a 2 grava um inteiro. Enquanto
    a migracao nao termina os dois convivem -- em disco e tambem dentro do
    processo, porque o registro v1 fica em memoria ate ter substituto. Toda
    leitura de "n" tem de passar por aqui; foi por nao fazer isso que o resumo
    estourou com TypeError depois de uma coleta inteira.
    """
    n = reg.get("n")
    if isinstance(n, dict):
        return max(n.values()) if n else 0
    return int(n or 0)


def promover(velho, linha):
    """Converte um registro da versao 1 para a 2 sem refazer a busca.

    A v1 ja gravou o id do jogo, entao falta so a leitura por plataforma -- uma
    requisicao em vez de duas. Havendo linha propria, o numero e substituido pelo
    da nossa versao; nao havendo, os valores antigos ficam de pe (sao o mesmo
    agregado que a v2 usaria de reserva) e so a forma do registro muda.
    """
    if linha:
        r = {}
        for nosso, campo in MEDIDAS:
            v = horas(linha.get(campo), linha.get("count_comp"))
            if v is not None:
                r[nosso] = v
        if r:
            r["n"] = int(linha.get("count_comp") or 0)
            r["via"] = "plataforma"
            for k in ("hltb", "nome", "ano"):
                if velho.get(k) is not None:
                    r[k] = velho[k]
            r["v"] = VERSAO
            return r
    r = {k: velho[k] for k in ("main", "plus", "cem") if k in velho}
    if not r:
        return None
    r["n"] = relatos(velho)
    r["via"] = "geral"
    for k in ("hltb", "nome", "ano"):
        if velho.get(k) is not None:
            r[k] = velho[k]
    r["v"] = VERSAO
    return r


def entradas(arquivos):
    """Os jogos que vale consultar, ja com a plataforma resolvida."""
    fila = []
    for arq, fixa in arquivos:
        lista = json.load(open(os.path.join(ROOT, "data", arq), encoding="utf-8"))
        if arq == "x360.json":
            # os cancelados que vazaram entram no catalogo pelo vazados.json e
            # aparecem no site como qualquer outro jogo -- entao tambem merecem
            # a consulta. Sao poucos, mas ficar de fora seria um buraco silencioso.
            vaz = os.path.join(ROOT, "data", "vazados.json")
            if os.path.exists(vaz):
                with open(vaz, encoding="utf-8") as f:
                    lista = lista + json.load(f).get("catalogo", [])
        for g in lista:
            plat = fixa or g.get("system")
            if plat not in PLAT:
                continue
            # ROM hack e homebrew: o HowLongToBeat tem alguns, mas o casamento por
            # titulo entre um hack nosso e um jogo de verdade la traria o tempo do
            # ORIGINAL. Nao ha como distinguir com seguranca, entao ficam de fora.
            if g.get("releaseType") and g["releaseType"] not in ("Released", "Vazado"):
                continue
            fila.append((g, plat))
    return fila


def salvar(caminho, dados):
    """Grava num temporario e troca com os.replace, que e atomico.

    json.dump direto no arquivo final trunca antes de escrever: quem ler naquele
    instante -- o bundle.py, ou este mesmo coletor sendo retomado -- pega JSON
    pela metade. A janela e de fracao de segundo a cada 25 jogos, o que e pouco
    para acontecer no teste e o bastante para acontecer numa coleta de horas.
    """
    d = os.path.dirname(caminho)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-hltb-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, caminho)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    refazer = "--refazer" in sys.argv
    alvo = argv[0] if argv else "xbox"
    limite = int(argv[1]) if len(argv) > 1 and argv[1].isdigit() else 0
    if alvo not in ALVOS:
        print("uso: fetch_hltb.py [xbox|indies|emu] [limite] [--refazer]")
        return 2
    arquivos, nome_saida = ALVOS[alvo]
    saida = os.path.join(ROOT, "data", nome_saida)

    dados, promoveis = {}, {}
    if os.path.exists(saida) and not refazer:
        with open(saida, encoding="utf-8") as f:
            bruto = json.load(f)
        for k, v in bruto.items():
            if v.get("v") == VERSAO:
                dados[k] = v
            elif v.get("nao"):
                # descarte nao depende da versao: a regra de CASAMENTO nao mudou
                # da v1 para a v2, so a de onde sai o numero. Refazer 855 buscas
                # que ja se sabe que nao casam seria pagar por nada.
                v["v"] = VERSAO
                dados[k] = v
            elif v.get("hltb"):
                # Entra nos DOIS: em promoveis para ser reprocessado, e em dados
                # para continuar existindo em disco enquanto isso nao acontece.
                # Sem a segunda parte, salvar() -- que grava so o que esta em
                # dados -- apaga do arquivo tudo que a fila ainda nao alcancou.
                # Foi o que aconteceu: um teste de 30 jogos levou junto 2.266
                # registros, e com eles os game_id que dispensavam a busca.
                dados[k] = v
                promoveis[k] = v

    fila = [(g, p) for g, p in entradas(arquivos)
            if g["id"] not in dados or g["id"] in promoveis]
    print("alvo=%s | ja na versao %d: %d | a promover (so 1 requisicao): %d | "
          "na fila: %d" % (alvo, VERSAO, len(dados) - len(promoveis),
                           len(promoveis), len(fila)))
    if limite:
        fila = fila[:limite]
    if not fila:
        print("nada a fazer")
        return 0

    ses = Sessao()
    if not ses.token():
        print("nao consegui o token da busca -- o site mudou ou a rede caiu")
        return 1

    com = sem = falha = 0
    contador = [0]
    t0 = time.time()
    for i, (g, plat) in enumerate(fila, 1):
        antigo = promoveis.get(g["id"])
        motivo = None
        if antigo:
            # ja sabemos qual jogo e: so falta a leitura por plataforma
            pd = ses.dados_do_jogo(antigo["hltb"])
            contador[0] += 1
            time.sleep(PAUSA)
            if pd is None:
                falha += 1
                continue
            r = promover(antigo, por_plataforma(pd, plat))
        else:
            c, motivo = consultar(ses, g, plat, contador)
            if c is None and motivo is None:
                falha += 1
                continue                # rede: nao grava, volta na proxima rodada
            r = None
            if c:
                pd = ses.dados_do_jogo(c.get("game_id")) if c.get("game_id") else []
                contador[0] += 1
                time.sleep(PAUSA)
                if pd is None:
                    # casou, mas a leitura por plataforma falhou. Gravar agora
                    # congelaria o agregado -- justamente o numero que a versao 2
                    # existe para nao usar quando ha alternativa.
                    falha += 1
                    continue
                r = registro(c, por_plataforma(pd, plat), plat)
        if r:
            dados[g["id"]] = r
            com += 1
        else:
            # grava a ausencia, senao reiniciar refaz do zero os que nao tem
            # tempo nenhum. bundle.py so olha entradas com medida.
            dados[g["id"]] = {"nao": motivo or "sem-medida", "v": VERSAO}
            sem += 1
        if i % 25 == 0 or i == len(fila):
            salvar(saida, dados)
            print("  %d/%d  com tempo=%d sem=%d rede=%d  %d consultas  %.0f min"
                  % (i, len(fila), com, sem, falha, contador[0],
                     (time.time() - t0) / 60), flush=True)

    salvar(saida, dados)
    uteis = [v for v in dados.values() if v.get("main") or v.get("plus") or v.get("cem")]
    poucos = sum(1 for v in uteis if relatos(v) < POUCOS_RELATOS)
    propria = sum(1 for v in uteis if v.get("via") == "plataforma")
    print("\ndata/%s: %d jogos consultados, %d com tempo (%d com menos de %d relatos)"
          % (nome_saida, len(dados), len(uteis), poucos, POUCOS_RELATOS))
    print("   tempo da NOSSA versao: %d | agregado de todas as versoes: %d"
          % (propria, len(uteis) - propria))
    motivos = {}
    for v in dados.values():
        if v.get("nao"):
            motivos[v["nao"]] = motivos.get(v["nao"], 0) + 1
    for m, q in sorted(motivos.items(), key=lambda x: -x[1]):
        print("   sem tempo | %-22s %d" % (m, q))
    return 0


if __name__ == "__main__":
    sys.exit(main())
