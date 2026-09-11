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
- **Filtros** (coluna da esquerda) — coleção, plataforma, modo de jogo, nº de jogadores,
  ano, retrocompatibilidade, extras (XBLA/Kinect/3D/Xbox One), categoria de homebrew, gênero e ordenação.
  Os filtros ficam salvos entre visitas.
- **Exportar coleção** — baixa um `.json` com a lista dos jogos que você tem.
- **Importar** — aceita esse mesmo arquivo (ou um array puro de ids), perguntando se você quer
  **somar** à coleção atual ou **substituir** tudo.

A coleção é guardada no `localStorage` do navegador. Como isso é por navegador e por perfil, o
**export é a forma de levar os dados para outra máquina** — ou de fazer backup.

### Formato do arquivo de coleção

```json
{
  "app": "xbox-vault",
  "version": 1,
  "exportedAt": "2026-09-11T18:40:00.000Z",
  "count": 42,
  "owned": ["x360-halo-3", "xbox-halo-combat-evolved", "hb-xbmc"]
}
```

Só a lista de ids é necessária para importar — dá para editar à mão sem medo.

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
  "image": "https://upload.wikimedia.org/...",
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
| **total** | **3.450** | **2.996 (87%)** | **3.450** |

O total de 2.155 do Xbox 360 bate com o contador da própria Wikipédia, e os 466
retrocompatíveis batem com a lista oficial final da Microsoft.

## Testes

`tests/` tem uma suíte de 25 asserções que dirige um Chrome headless e exercita filtros,
busca, marcação, export e import. Veja `tests/README.md`.

## Procedência dos dados

As listas de Xbox 360 e Xbox original vêm das listas da Wikipédia em inglês (`List of Xbox 360
games (A–L)` / `(M–Z)`, `List of Xbox games`, `List of Xbox games compatible with Xbox 360`),
raspadas por script — não digitadas à mão. As capas vêm da imagem principal de cada artigo.

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
