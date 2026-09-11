# Xbox Vault

**No ar: https://lucas-tito.github.io/xbox-vault/**

Catálogo navegável de **todos os jogos de Xbox 360**, **todos os do Xbox original** (com
classificação de retrocompatibilidade com o 360) e uma lista de **homebrews** das duas consoles.
Agrupado por ano, com filtros por modo de jogo, número de jogadores, gênero e mais — e com
marcação de "eu tenho" que você exporta e importa como arquivo.

## Como abrir

Pelo navegador, é só acessar o link acima. Para rodar local, basta **abrir o `index.html`** no navegador (duplo clique). Não precisa de servidor: os dados são
carregados via `<script>`, não por `fetch()`, justamente para funcionar em `file://`.

Se preferir servir por HTTP:

```bash
python3 -m http.server 8000   # depois acesse http://localhost:8000
```

## Usando

- **Marcar que tenho** — clique em qualquer ponto do card (ou no botão `+` no canto). O card fica
  destacado em verde. O clique no *título* abre a página do jogo na Wikipédia.
- **Wishlist** — o botão `☆` no canto do card. Fica destacado em âmbar.
  "Tenho" e "quero" são mutuamente exclusivos: marcar um limpa o outro, porque as duas coisas se
  contradizem e o contrário deixaria o mesmo jogo nas duas listas do arquivo exportado.
- **Filtros** (coluna da esquerda) — coleção, plataforma, modo de jogo, nº de jogadores,
  ano, retrocompatibilidade, extras (XBLA/Kinect/3D/Xbox One), categoria de homebrew, gênero e ordenação.
  Os filtros ficam salvos entre visitas.
- **Exportar coleção** — baixa um `.json` com a coleção **e** a wishlist.
- **Importar** — aceita esse mesmo arquivo (ou um array puro de ids), perguntando se você quer
  **somar** ao que já está aqui ou **substituir** tudo.

A coleção e a wishlist ficam no `localStorage` do navegador. Como isso é por navegador **e por
origem**, o que você marca em `lucas-tito.github.io` não aparece ao abrir o `index.html` local, e
vice-versa. O **export é a ponte entre os dois** — e o backup se você limpar os dados do navegador.

### Formato do arquivo de coleção

```json
{
  "app": "xbox-vault",
  "version": 2,
  "exportedAt": "2026-09-11T18:40:00.000Z",
  "count": 42,
  "wishlistCount": 7,
  "owned": ["x360-halo-3", "xbox-halo-combat-evolved", "hb-xbmc"],
  "wishlist": ["x360-red-dead-redemption"]
}
```

Só as listas de ids importam — dá para editar à mão sem medo. Arquivos da `version: 1` (sem
wishlist) continuam sendo aceitos, e um array puro de ids também.

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
  db.js             tudo acima unido, é o que o site carrega
tools/
  wikilib.py        acesso à API da Wikipédia (com cache em disco) + parser de wikitext
  taglib.py         extração de modos de jogo a partir do artigo
  build_*.py        geram os data/*.json das listas
  tag_*.py          geram os data/tags-*.json
  bundle.py         une os JSONs em data/db.js
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
python3 tools/bundle.py         # <- sempre por último: escreve data/db.js
```

Todos são idempotentes e usam `cache/`, então re-rodar é barato. **Depois de qualquer edição nos
JSONs, rode `tools/bundle.py`** — o site lê o `db.js`, não os JSONs.

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
  "imageRemote": "https://upload.wikimedia.org/...",  // reserva, se o arquivo faltar
  "tags": {
    "singlePlayer": true, "multiplayerLocal": true, "multiplayerOnline": true,
    "coop": true, "coopLocal": true, "versus": true, "versusLocal": true,
    "maxPlayersLocal": 4, "maxPlayersOnline": 16, "maxPlayers": 16,
    "source": "manual", "confidence": "high"
  }
}
```

Campos ausentes em `tags` significam `false` / `0` — o bundler remove os vazios para o arquivo
não ficar gigante. `maxPlayers* = 0` quer dizer **desconhecido**, não "zero jogadores".

## Números

| | jogos | com capa | com tags |
|---|---|---|---|
| Xbox 360 | 2.155 | 1.948 (90%) | 2.155 |
| Xbox original | 995 (466 retrocompatíveis) | 918 (92%) | 995 |
| Homebrew | 300 | 130 | 300 |
| **total** | **3.450** | **3.236 (94%)** | **3.450** |

Contando só jogos comerciais (o homebrew raramente teve capa), a cobertura é de
**3.106 de 3.150 — 98,6%**.

O total de 2.155 do Xbox 360 bate com o contador da própria Wikipédia, e os 466
retrocompatíveis batem com a lista oficial final da Microsoft.

## Testes

`tests/` tem uma suíte de 25 asserções que dirige um Chrome headless e exercita filtros,
busca, marcação, export e import. Veja `tests/README.md`.

## Procedência dos dados

As capas vêm de duas fontes. A principal é a imagem do artigo da Wikipédia; para os ~280 títulos
sem imagem lá (lançamentos só no Japão, shovelware, jogos sem artigo), o
`tools/fetch_images_launchbox.py` completa a partir do dump aberto do
[LaunchBox Games Database](https://gamesdb.launchbox-app.com/), que tem box art de console e não
exige chave de API — 240 dos 284 casaram por título normalizado. Todas as imagens são
reduzidas para 240px de largura e convertidas em WebP q72 antes de entrar no repositório.

As listas de Xbox 360 e Xbox original vêm das listas da Wikipédia em inglês (`List of Xbox 360
games (A–L)` / `(M–Z)`, `List of Xbox games`, `List of Xbox games compatible with Xbox 360`),
raspadas por script — não digitadas à mão. 
As **tags de modo de jogo** são de qualidade desigual, e o campo `tags.confidence` diz qual é qual:

- `high` — veio do campo *modes* da infobox do artigo, ou foi conferido à mão.
- `medium` — inferido do texto do artigo (seções de gameplay/multiplayer).
- `low` — inferido do gênero, ou o jogo nem tem artigo na Wikipédia.

Ou seja: `singlePlayer`/`multiplayer` são confiáveis; **co-op vs. versus e o número exato de
jogadores são estimativas** para a cauda longa do catálogo. Os títulos mais conhecidos foram
revisados manualmente. Se achar um erro, corrija o `data/tags-*.json` e rode o `bundle.py`.

Uma convenção que vale saber: nos jogos de **Xbox original**, `maxPlayersOnline` guarda o
número de jogadores **em rede**, que na prática costuma ser System Link (LAN), já que o Xbox
Live só existiu a partir de novembro de 2002. Por isso um jogo pode ter `multiplayerOnline:
false` e `maxPlayersOnline: 16` — é o caso do Halo: Combat Evolved, que fazia 16 jogadores
ligando consoles em rede local. O site só mostra a tag "ONLINE" quando `multiplayerOnline` é
true, então nada aparece indevidamente.

Nos **homebrews**, 211 das 300 entradas são emuladores, dashboards e utilitários — não são
jogos, e saem com todas as tags de modo zeradas de propósito. Só os 55 ports, os 20 jogos
autorais e 14 emuladores de arcade (que rodam jogos de 2 jogadores no mesmo console) têm
modo de jogo.

A lista de homebrew não tem fonte canônica — é uma compilação pesquisada, e cada entrada traz um
campo `verified` indicando a confiança.
