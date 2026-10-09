# Xbox Vault: regras de trabalho

O Claude Code lê este arquivo no começo de toda conversa aberta nesta pasta, então as regras valem para qualquer chat novo.

## Testes: rodar só o que a mudança pede

As baterias em `tests/` rodam só aqui, num Chrome sem janela (não há automação no GitHub), e cada uma leva de 1 a 3 minutos. Rodar todas a cada ajuste deixa o trabalho lento demais.

- **Mudança só de visual** (CSS de tamanho, cor, espaçamento, fonte): nenhuma bateria. Confere com um print.
- **Mudança de comportamento**: só a bateria daquela parte.
  - filtros, busca, cards, marcações, importar e exportar: `tests/suite.js`
  - emulação: `tests/emutest.js`
  - CollectionUI: `tests/cui.js`
  - gaveta de filtros do celular: `tests/mobile.js` (janela estreita)
  - fonte nova ou qualquer coisa que carregue arquivo: `tests/netcheck.mjs`
- **Todas as baterias**: só antes de uma mudança grande de comportamento, ou ao fechar um bloco de trabalho.
- Cada bateria num perfil de Chrome descartável, apagado depois: o diretório temporário tem cota e enche. Perfil reaproveitado guarda busca e filtros no navegador e faz teste falhar sem motivo.
- A suíte marca falha como `FALL`, não `FAIL`. Contar as duas grafias.

## Escrita e commits

- Tudo que o Lucas vê sai em português, inclusive a descrição dos comandos Bash e o relatório de subagente.
- Sem travessão: reescrever a frase, nunca trocar o travessão por hífen.
- Commits atômicos, um assunto por commit, mensagem em português explicando o porquê.
- Nada de `Co-Authored-By` nem `Claude-Session` nas mensagens.
- Push pela conta pessoal, por token e sem `gh auth switch` (a conta ativa da máquina é a de trabalho e fica como está): `GH_TOKEN=$(gh auth token --user Lucas-Tito) git push origin main`. O mesmo prefixo vale para qualquer comando `gh` neste repositório. Conferir depois no GitHub.
