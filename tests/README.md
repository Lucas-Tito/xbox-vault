# Testes

Suíte de ponta a ponta que dirige um Chrome de verdade pelo DevTools Protocol e exercita
o site como um usuário: filtros, busca, marcar "tenho", export e import.

```bash
google-chrome --headless=new --disable-gpu --remote-debugging-port=9224 \
  --user-data-dir=/tmp/xbxtest about:blank &
sleep 4
node tests/drive.mjs "file://$PWD/index.html" tests/suite.js
```

58 asserções. Elas já pegaram quatro bugs reais:

- `Array.prototype.slice.call(owned)` com um `Set` devolve `[]` — a exportação gravava
  uma lista vazia enquanto o contador na tela mostrava o número certo. Só apareceu porque
  o teste lê o conteúdo do arquivo exportado em vez de confiar na interface.
- Contagens dos filtros divergindo do catálogo real.
- Import aceitando ids inexistentes.
- `closeModal()` escondia o modal sem limpar o conteúdo, deixando os botões do diálogo anterior
  vivos no DOM e reativáveis.

Por isso as asserções comparam contra `window.XBX_DB` recalculado na hora, e não contra
números fixos: se os dados mudarem, o teste continua válido.
