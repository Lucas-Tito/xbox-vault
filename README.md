# Xbox Vault

**No ar: https://lucas-tito.github.io/xbox-vault/**

Catálogo navegável de **todos os jogos de Xbox 360**, **todos os do Xbox original** (com
classificação de retrocompatibilidade com o 360) e uma lista de **homebrews** das duas consoles.
Agrupado por ano, com filtros por modo de jogo, número de jogadores, gênero e mais, e com
marcação de "eu tenho" que você exporta e importa como arquivo.

## Como abrir

Pelo navegador, é só acessar o link acima. Para rodar local, basta **abrir o `index.html`** no navegador (duplo clique). Não precisa de servidor: os dados são
carregados via `<script>`, não por `fetch()`, justamente para funcionar em `file://`. São quatro
arquivos: o `db.js` desce sempre, com 2,5 MB, e `db-xblig.js`, `db-hb.js` e `db-emu.js` descem só
quando você liga a categoria correspondente.

Se preferir servir por HTTP:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
```

## Usando

- **Ver detalhes**: clique no card. Abre um popup em quatro abas. **Visão geral** tem descrição,
  galeria de capturas, tempo de jogo, Kinect e retrocompatibilidade com os problemas conhecidos.
  **Modos e co-op** tem os modos com número de jogadores e o que o Co-Optimus sabe do co-op.
  **Conteúdo adicional** tem os Title Updates. **Ficha técnica** tem ano, gênero, quem fez, quem
  publicou e os links. Aba sem conteúdo não aparece, então o número de abas muda de jogo para
  jogo, e jogo com uma aba só abre sem barra de abas. `Esc` ou clique fora fecham.
- **Marcar que tenho** é coisa do popup, o card não tem botão para isso. Quem tem fica
  destacado em verde, com a borda acesa e a capa em cor cheia, enquanto o resto do catálogo
  aparece levemente dessaturado.
- **Wishlist**: o botão `☆` no canto do card, ou dentro do popup. Fica destacado em âmbar.
- **Nota do Metacritic**: no canto da capa, nas cores do próprio Metacritic (verde 75+, amarelo
  50–74, vermelho abaixo). Dá para filtrar por nota mínima e ordenar por nota. **2.223 jogos têm
  nota**: 67% do Xbox 360 e 78% do Xbox original; XBLIG e emulação não têm.
- **Emulação**: desligada por padrão. Ao ligar, o site baixa `data/db-emu.js` (uma vez por
  visita) com SNES, GBA e PS1, que o 360 roda via homebrew. Traz um sub-filtro por sistema e outro por tipo de
  lançamento, que começa em **só oficiais**: dos 9.962, apenas 7.976 são jogos licenciados; o
  resto são 1.478 ROM hacks, 222 homebrew, 138 não-licenciados e 136 nunca lançados.
- **Não quero**: o botão `⊘`. O jogo sai de todas as listas e só reaparece no filtro
  *Só os que eu escondi*, de onde dá para desfazer. Serve para tirar da frente o que não te
  interessa (shovelware, esporte anual, o que for) num catálogo de 3.450 títulos.
  "Tenho" e "quero" são mutuamente exclusivos: marcar um limpa o outro, porque as duas coisas se
  contradizem e o contrário deixaria o mesmo jogo nas duas listas do arquivo exportado.
- **Só os que eu ainda não marquei**: na caixa *Coleção*. Mostra o que ainda não passou por
  nenhuma decisão: nem tenho, nem wishlist, nem escondido. É diferente de *Só os que faltam*,
  que traz a wishlist junto, e serve para ir varrendo o catálogo sem reencontrar o que você já
  resolveu. Marcar um jogo com o filtro ligado tira o card da tela na hora.
- **Filtros no celular**: o botão *Filtros* abre uma gaveta de tela cheia, com o número de jogos
  que passam pelo filtro no rodapé, ao vivo. Fecha pelo `×`, pelo botão do rodapé ou com `Esc`.
- **Filtros** (coluna da esquerda): coleção, plataforma, modo de jogo, nº de jogadores,
  ano, retrocompatibilidade, extras (XBLA/Kinect/3D/Xbox One), categoria de homebrew, gênero e ordenação.
  Os filtros ficam salvos entre visitas. **Indie (XBLIG), homebrew e emulação nascem
  desmarcados**: o catálogo abre no Xbox 360 e no Xbox original, e as outras três entram quando
  você liga. Cada uma mora num arquivo próprio e só é baixada nesse momento, uma vez por visita,
  então quem nunca liga não paga o peso delas. O contador ao lado de cada categoria mostra o
  tamanho dela mesmo antes de baixar, porque esse total viaja no arquivo principal.
- **Tamanho do download**: na aba Visão geral do popup, para **2.798 jogos**, vindo das páginas
  do Marketplace arquivadas no Internet Archive. É o download real, e não a imagem de disco com
  enchimento, onde quase tudo cairia em 7,30 ou 8,14 GB. Abaixo de 1 GB aparece em MB, porque 83%
  do catálogo está aí e a mediana é 0,04 GB.
- **Tamanho na emulação**: para **6.638 dos 7.976 jogos oficiais** (83%), de fonte diferente: os
  DATs do No-Intro, para cartucho, e do Redump, para disco, reunidos no `libretro-database`. Aqui
  o número é o da **ROM extraída**, que é o que ocupa no HD, e não o do arquivo compactado. A
  mediana no SNES é 1 MB e nenhum PS1 passa de 0,70 GB, porque um CD não passa. Quando o mesmo
  jogo existe em várias regiões, vale a americana, depois a mundial, a europeia e a japonesa,
  nessa ordem, e a região escolhida fica gravada.
- **Exportar coleção**: baixa um `.json` com a coleção **e** a wishlist.
- **Importar**: aceita esse mesmo arquivo (ou um array puro de ids), perguntando se você quer
  **somar** ao que já está aqui ou **substituir** tudo.

Suas marcações ficam no `localStorage` do navegador e **sobrevivem a fechar e reabrir**: no dia a
dia não é preciso exportar nada. Três ressalvas:

- É **por navegador e por origem**: o que você marca em `lucas-tito.github.io` não aparece ao abrir
  o `index.html` local, e Chrome e Firefox não compartilham nada.
- **Limpar dados de navegação apaga**, e janela anônima não guarda ao fechar.
- Fechamento normal grava em disco; um travamento duro do sistema pode perder a última escrita.

Por isso o **export existe como backup** e como forma de levar a coleção para outra máquina ou
outro navegador, não como parte do uso normal.

### Formato do arquivo de coleção

```json
{
  "app": "xbox-vault",
  "version": 3,
  "exportedAt": "2026-09-11T18:40:00.000Z",
  "count": 42,
  "wishlistCount": 7,
  "owned": ["x360-halo-3", "xbox-halo-combat-evolved", "hb-xbmc"],
  "wishlist": ["x360-red-dead-redemption"],
  "marks": {
    "x360-halo-3": { "s": "own",  "t": 1789100000000 },
    "x360-red-dead-redemption": { "s": "wish", "t": 1789100000001 },
    "x360-fable-iii": { "s": null, "t": 1789100000002 }
  }
}
```

`marks` é a fonte da verdade: `s` é o estado (`own`, `wish`, `hide` ou `null` para "desmarcado") e
`t` é quando mudou, em milissegundos. O timestamp faz a importação juntar direito: importar um
arquivo mais antigo não desfaz o que você marcou depois, e um jogo desmarcado guarda uma *lápide*
(`s: null`) em vez de sumir, para que a remoção também viaje. `owned`, `wishlist` e `hidden`
continuam ali para leitura humana e para importadores antigos. Arquivos `version: 1` e `2` (sem `marks`) continuam sendo aceitos, e um array
puro de ids também.

## Estrutura

```
index.html          página
style.css           estilo
app.js              filtros, render, coleção, export/import
data/
  x360.json         jogos de Xbox 360          <- fonte da verdade
  xbox.json         jogos de Xbox original     <- fonte da verdade
  homebrew.json     homebrews                  <- fonte da verdade
  tags-*.json       modos de jogo + URL da capa, indexado por id
  tamanho.json      tamanho do download, em GB, do Marketplace arquivado
  tamanho-emu.json  tamanho da ROM extraída, em GB, dos DATs do No-Intro e do Redump
  jogadores-emu.json  nº de jogadores da emulação; manda no que o LaunchBox diz
  tempo.json        tempo de jogo conferido à mão      <- manda no hltb*.json
  hltb*.json        tempo de jogo do HowLongToBeat, um arquivo por alvo
  db.js             Xbox 360 + Xbox original, é o que carrega no primeiro byte
  db-xblig.js       XBLIG, baixado só quando a categoria é ligada
  db-hb.js          homebrew, idem
  db-emu.js         emulação, idem
tools/
  wikilib.py        acesso à API da Wikipédia (com cache em disco) + parser de wikitext
  jsonio.py         gravação atômica: todo coletor grava por aqui
  taglib.py         extração de modos de jogo a partir do artigo
  build_*.py        geram os data/*.json das listas
  tag_*.py          geram os data/tags-*.json
  fetch_hltb.py     tempo de jogo do HowLongToBeat (resumível)
  fetch_libretro.py tamanho e nº de jogadores da emulação, dos DATs do libretro
  fetch_screens_libretro.py  uma captura por jogo, dos thumbnails do libretro
  bundle.py         une os JSONs nos quatro db*.js
images/             capas em WebP (240px, q72), uma por jogo, versionadas no repo
cache/              respostas da API da Wikipédia (pode apagar; será rebaixado)
```

### Regerar os dados

```bash
python3 tools/build_x360.py     # lista do 360
python3 tools/build_xbox.py     # lista do Xbox original + retrocompatibilidade
python3 tools/build_homebrew.py # homebrews
python3 tools/tag_x360.py       # tags + capas
python3 tools/tag_xbox.py
python3 tools/tag_homebrew.py
python3 tools/fetch_images.py   # baixa e comprime as capas em images/ (resumível)
python3 tools/fetch_images_launchbox.py  # completa as que a Wikipédia não tem
python3 tools/fetch_images_extra.py      # links verificados à mão para o resto
python3 tools/fetch_hltb.py xbox         # tempo de jogo: 360 + Xbox original
python3 tools/fetch_hltb.py emu          # idem, catálogo de emulação
python3 tools/fetch_hltb.py indies       # idem, XBLIG
python3 tools/fetch_libretro.py          # tamanho e nº de jogadores da emulação
python3 tools/fetch_screens_libretro.py   # captura de gameplay: emulação e Xbox original
python3 tools/bundle.py         # <- sempre por último: escreve os quatro db*.js
```

Todos são idempotentes e usam `cache/`, então re-rodar é barato. **Depois de qualquer edição nos
JSONs, rode `tools/bundle.py`**: o site lê o `db.js`, não os JSONs.

### Schema de um jogo

```jsonc
{
  "id": "x360-halo-3",              // chave estável; é o que vai no arquivo de export
  "platform": "x360",               // x360 | xbox | homebrew
  "title": "Halo 3",
  "wiki": "Halo 3",                 // artigo na Wikipédia (pode ser null)
  "year": 2007,
  "genre": "First-person shooter",
  "developers": ["Bungie"],
  "publishers": ["Microsoft Game Studios"],
  "flags": { "xbla": false, "kinect": null, "stereo3d": false, "xboxOne": true },
  "bc360": { "compatible": true, "region": "all", "issues": null },  // só Xbox original
  "image": "images/x360-halo-3.webp",   // arquivo local versionado no repo
  "tamanho": 0.402,                 // GB do download do Marketplace; o popup mostra em MB abaixo de 1 GB
  "imageRemote": "https://upload.wikimedia.org/...",  // reserva, se o arquivo faltar
  "tags": {
    "singlePlayer": true, "multiplayerLocal": true, "multiplayerOnline": true,
    "coop": true, "coopLocal": true, "versus": true, "versusLocal": true,
    "maxPlayersLocal": 4, "maxPlayersOnline": 16, "maxPlayers": 16,
    "source": "manual", "confidence": "high"
  }
}
```

Campos ausentes em `tags` significam `false` / `0`: o bundler remove os vazios para o arquivo
não ficar gigante. `maxPlayers* = 0` quer dizer **desconhecido**, não "zero jogadores".

## Números

| | jogos | com capa | com captura | com tags |
|---|---|---|---|---|
| Xbox 360 | 2.156 | 2.147 (100%) | 1.500 (70%) | 2.156 |
| Xbox original | 995 (466 retrocompatíveis) | 994 (100%) | 828 (83%) | 995 |
| Indie (XBLIG) | 3.450 | 3.450 (100%) | 3.308 (96%) | 3.450 |
| Homebrew | 808 | 331 (41%) | 0 | 808 |
| Emulação (sob demanda) | 9.830 | 8.869 (90%) | 6.516 (66%) | 9.830 |
| **total** | **17.239** | **15.791 (92%)** | **12.152 (70%)** | **17.239** |

No repositório isso são **187 MB de capas** e **286 MB de capturas**, em WebP.

Contando só jogos comerciais, ou seja, 360, Xbox original e XBLIG, a cobertura de capa é de
**6.591 de 6.601, ou 99,8%**: faltam 9 do 360 e 1 do Xbox original. Os buracos de verdade estão
nas outras duas categorias, e por motivos diferentes. Dos 808 homebrews, 477 não têm capa, e boa
parte são utilitários de linha de comando que nunca tiveram interface, então nem screenshot
existe. Na emulação, 961 dos 9.830 ficaram sem, quase todos ROM hack e homebrew.

Captura de gameplay tem duas origens: a galeria do Marketplace, que só existiu para 360 e XBLIG, e
os thumbnails do libretro, que cobrem Xbox original, SNES, GBA e PS1 com uma por jogo. Homebrew
não tem nenhuma das duas.

Os 466 retrocompatíveis batem com a lista oficial final da Microsoft, e o total do Xbox 360 vem do
contador da própria Wikipédia.

## Testes

`tests/` dirige um Chrome headless de verdade e exercita o site como um usuário: **226 asserções**
sobre filtros, busca, popup de detalhes, marcação, wishlist, "não quero", merge por timestamp,
export/import, emulação sob demanda e a gaveta de filtros do celular. Mais **24 em Python**, que
cobrem o que não aparece na tela: a precedência entre tempo curado à mão e coletado, e a gravação
atômica dos coletores. E uma auditoria que falha se a página fizer qualquer requisição externa.
Veja `tests/README.md`.

### De onde vem a nota do Metacritic

Não dá para raspar o Metacritic (bloqueio agressivo), mas os artigos da Wikipédia citam a nota
**junto com a URL da página do Metacritic**, e essa URL diz a plataforma
(`?platform=xbox-360`). É a própria Wikipédia dizendo de qual versão é aquela nota, o que importa
porque um mesmo jogo tem notas diferentes em cada plataforma.

O `tools/metacritic.py` trata três formatos que convivem nos artigos: `MC = 94/100` (jogo único),
`MC_XBOX = 95/100` (plataforma no nome do campo) e `game1/mc1` (artigo de série, uma nota por
jogo). 79% das notas saíram pelo casamento por URL, que é o mais confiável.

A distribuição das 2.223 notas serve de sanidade: curva em sino centrada em **69,5**, com só 93
jogos acima de 90, o formato da distribuição real do Metacritic.

### De onde vem o tempo de jogo

Quanto tempo um jogo leva não está na Wikipédia, nem no x360db, nem no Metacritic. Esse número só
existe porque milhares de jogadores anotaram o próprio tempo, e o lugar onde isso está agregado é
o [HowLongToBeat](https://howlongtobeat.com/), em três medidas que são exatamente as três que o
`data/tempo.json` já previa: história principal, principal + extras, e 100%.

**Duas fontes, uma regra de precedência.** `data/tempo.json` é curadoria à mão e manda no que
estiver lá: número conferido por uma pessoa não é substituído por média de internet. A única
exceção é a entrada marcada `"fonte": "aproximado"`, que o próprio cabeçalho do arquivo define
como estimativa posta para a interface ter o que mostrar: essa cede a vez assim que o coletor
trouxer número de verdade. Quem decide é o `juntar_tempo()` do `bundle.py`, e a regra é testada em
`tests/tempo.py`, não só documentada, porque um erro ali apagaria curadoria em silêncio, mostrando na
tela um número plausível só que errado.

**A contagem de relatos vai junto, e não é enfeite.** Portal 2 tem 5.533 relatos e a média vale;
um obscuro de PS1 com 1 relato é o tempo de *uma pessoa*, que não é média de nada. As duas coisas
são a mesma frase, "8h", com valor muito diferente, então o popup mostra os dois números e avisa
quando a amostra tem menos de 5 relatos. Quem lê decide.

**O casamento é estrito de propósito.** Exige título normalizado idêntico (ao nome ou ao *alias*
do site) **e** a nossa plataforma presente na lista da entrada. "Halo: Combat Evolved" e "Halo:
Combat Evolved - Anniversary" são dois jogos com tempos diferentes; "A.R.E.S.: Extinction Agenda"
e o "EX" também. O preço disso é perder casos legítimos: *Abyss Odyssey* existe no site mas sem
Xbox 360 na lista de plataformas, e *Quantum of Solace* está lá sem o prefixo "007:" que o nosso
catálogo usa. Esses descartes ficam gravados com motivo separado (`so-outra-plataforma`) em vez de
virarem um "não achei" opaco, justamente para dar para medir o tamanho do prejuízo depois sem
rodar a coleta de novo.

O ano **não** reprova um casamento, só desempata: o ano do HowLongToBeat é o do lançamento
mundial e o nosso costuma ser o da versão que catalogamos. *Crysis* é 2007 lá e 2011 aqui, porque
o que temos é a porta de Xbox 360. Quem usa ano como filtro perde toda porta tardia.

## Nenhuma requisição externa

O site funciona inteiro a partir do próprio repositório: capas, catálogo e notas são arquivos
locais. Os scripts de `tools/` é que vão à rede, na hora de gerar os dados e não na hora de usar.

Isso é verificado, não prometido: `tests/netcheck.mjs` intercepta toda requisição que a página
faz e falha se alguma sair do domínio. As únicas URLs externas que restam no catálogo são o campo
`url` dos homebrews, que vira o link "Página do projeto", que abre só se você clicar.

## Procedência dos dados

As capas vêm de duas fontes. A principal é a imagem do artigo da Wikipédia; para os ~280 títulos
sem imagem lá (lançamentos só no Japão, shovelware, jogos sem artigo), o
`tools/fetch_images_launchbox.py` completa a partir do dump aberto do
[LaunchBox Games Database](https://gamesdb.launchbox-app.com/), que tem box art de console e não
exige chave de API: 240 dos 284 casaram por título normalizado.

O que sobrou depois dessas duas passadas foi caçado uma a uma por `tools/fetch_images_extra.py`,
que tem os 138 links verificados à mão num dicionário no topo: GameBrew, TheGamesDB,
libretro-thumbnails, ConsoleMods recuperado pela Wayback Machine, READMEs de repositórios no
GitHub e o Internet Archive. Para homebrew o alvo não é box art (esses projetos nunca tiveram
caixa) e sim o logo do projeto ou uma captura da interface.

Todas as imagens são reduzidas para 240px de largura e convertidas em WebP q72 antes de entrar
no repositório.

As listas de Xbox 360 e Xbox original vêm das listas da Wikipédia em inglês (`List of Xbox 360
games (A–L)` / `(M–Z)`, `List of Xbox games`, `List of Xbox games compatible with Xbox 360`),
raspadas por script, não digitadas à mão. 
As **tags de modo de jogo** são de qualidade desigual, e o campo `tags.confidence` diz qual é qual:

- `high`: veio do campo *modes* da infobox do artigo, ou foi conferido à mão.
- `medium`: inferido do texto do artigo (seções de gameplay/multiplayer).
- `low`: inferido do gênero, ou o jogo nem tem artigo na Wikipédia.

Ou seja: `singlePlayer`/`multiplayer` são confiáveis; **co-op vs. versus e o número exato de
jogadores são estimativas** para a cauda longa do catálogo. Os títulos mais conhecidos foram
revisados manualmente. Se achar um erro, corrija o `data/tags-*.json` e rode o `bundle.py`.

Uma convenção que vale saber: nos jogos de **Xbox original**, `maxPlayersOnline` guarda o
número de jogadores **em rede**, que na prática costuma ser System Link (LAN), já que o Xbox
Live só existiu a partir de novembro de 2002. Por isso um jogo pode ter `multiplayerOnline:
false` e `maxPlayersOnline: 16`, que é o caso do Halo: Combat Evolved, que fazia 16 jogadores
ligando consoles em rede local. O site só mostra a tag "ONLINE" quando `multiplayerOnline` é
true, então nada aparece indevidamente.

Nos **homebrews**, 211 das 300 entradas são emuladores, dashboards e utilitários, que não são
jogos, e saem com todas as tags de modo zeradas de propósito. Só os 55 ports, os 20 jogos
autorais e 14 emuladores de arcade (que rodam jogos de 2 jogadores no mesmo console) têm
modo de jogo.

A lista de homebrew não tem fonte canônica: é uma compilação pesquisada, e cada entrada traz um
campo `verified` indicando a confiança.
