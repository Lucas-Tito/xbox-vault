# Testes

Suíte de ponta a ponta que dirige um Chrome de verdade pelo DevTools Protocol e exercita
o site como um usuário: filtros, busca, marcar "tenho", export e import.

```bash
google-chrome --headless=new --disable-gpu --remote-debugging-port=9224 \
  --user-data-dir=/tmp/xbxtest about:blank &
sleep 4
node tests/drive.mjs "file://$PWD/index.html" tests/suite.js
```

```bash
# emulação: carregamento sob demanda, sub-filtros, tipo de lançamento
node tests/drive.mjs "file://$PWD/index.html" tests/emutest.js

# a emulação sobrevive a um reload com o filtro salvo? (roda os dois em sequência)
node tests/drive.mjs "file://$PWD/index.html" tests/bootemu.js
node tests/drive.mjs "file://$PWD/index.html" tests/bootemu2.js

# auditoria de rede: prova que a página não faz requisição a domínio externo
node tests/netcheck.mjs "file://$PWD/index.html"
node tests/netcheck.mjs "file://$PWD/index.html" emu
```

69 + 13 + 2 asserções, mais a auditoria de rede. Elas já pegaram seis bugs reais:

- `Array.prototype.slice.call(owned)` com um `Set` devolve `[]` — a exportação gravava
  uma lista vazia enquanto o contador na tela mostrava o número certo. Só apareceu porque
  o teste lê o conteúdo do arquivo exportado em vez de confiar na interface.
- Contagens dos filtros divergindo do catálogo real.
- Import aceitando ids inexistentes.
- `closeModal()` escondia o modal sem limpar o conteúdo, deixando os botões do diálogo anterior
  vivos no DOM e reativáveis.
- Ordenar por título ou por nota continuava agrupando os cards por ano, criando dezenas de seções
  de um jogo só.
- Com a emulação ligada numa visita anterior, o filtro salvo a pedia mas nada disparava o
  carregamento no boot — e a lista aparecia **vazia**. Esse foi achado por acidente: um script de
  auditoria deixou o estado para trás e a suíte seguinte quebrou.

Por isso as asserções comparam contra `window.XBX_DB` recalculado na hora, e não contra
números fixos: se os dados mudarem, o teste continua válido.
