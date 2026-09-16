# Testes

Suíte de ponta a ponta que dirige um Chrome de verdade pelo DevTools Protocol e exercita
o site como um usuário: filtros, busca, marcar "tenho", export e import.

```bash
google-chrome --headless=new --disable-gpu --remote-debugging-port=9227 \
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

# gaveta de filtros do celular: precisa de janela ESTREITA, senão não testa nada
google-chrome --headless=new --disable-gpu --window-size=500,760 \
  --remote-debugging-port=9227 --user-data-dir=/tmp/xbxmob about:blank &
sleep 4
node tests/drive.mjs "file://$PWD/index.html" tests/mobile.js

# auditoria de rede: prova que a página não faz requisição a domínio externo
node tests/netcheck.mjs "file://$PWD/index.html"
node tests/netcheck.mjs "file://$PWD/index.html" emu
```

```bash
# precedência do tempo de jogo: prova que o coletor não apaga curadoria à mão
python3 tests/tempo.py

# gravação atômica: prova que coleta interrompida não deixa JSON pela metade
python3 tests/atomico.py
```

176 + 25 + 4 + 15 asserções no navegador, 24 em Python, mais a auditoria de rede.

Os dois de Python são de natureza diferente dos outros: não dirigem o site, exercitam o que roda
antes dele. O `tempo.py` cobre a função do `bundle.py` que decide entre `data/tempo.json` (escrito
por uma pessoa) e `data/hltb*.json` (escrito por um robô que roda por horas sem ninguém olhando):
esse erro não apareceria na tela — o site mostraria um número plausível, só que o errado, e a
curadoria teria sumido sem aviso.

O `atomico.py` cobre o `tools/jsonio.py`, por onde passa a gravação de todo coletor. O bug que ele
previne também não aparece rodando o coletor: a janela de arquivo truncado dura uma fração de
segundo por save, tempo curto demais para o acaso mostrar num teste e longo o bastante para
acontecer numa coleta de horas. Então em vez de tentar flagrar a janela, o teste afirma as
condições que a eliminam, uma a uma: formato de saída idêntico ao de antes, temporário no mesmo
diretório do destino (fora dele o `os.replace` deixa de ser atômico), e erro de serialização ou
`Ctrl+C` no meio sem tocar no arquivo que já estava lá nem deixar lixo.

O `mobile.js` é o único que exige uma janela de tamanho específico, e a primeira asserção dele
confere isso: acima de 820px a media query nem entra, e o arquivo inteiro passaria sem testar nada.

As do navegador já pegaram sete bugs reais:

- `Array.prototype.slice.call(owned)` com um `Set` devolve `[]` — a exportação gravava
  uma lista vazia enquanto o contador na tela mostrava o número certo. Só apareceu porque
  o teste lê o conteúdo do arquivo exportado em vez de confiar na interface.
- Contagens dos filtros divergindo do catálogo real.
- Import aceitando ids inexistentes.
- `closeModal()` escondia o modal sem limpar o conteúdo, deixando os botões do diálogo anterior
  vivos no DOM e reativáveis.
- Ordenar por título ou por nota continuava agrupando os cards por ano, criando dezenas de seções
  de um jogo só.
- No celular, a coluna de filtros era ancorada em 57px, a altura do cabeçalho no desktop. Numa
  tela estreita o cabeçalho quebra em várias linhas e chega a 261px, então os primeiros 204px da
  coluna nasciam atrás dele e o grupo *Coleção* inteiro ficava invisível. Quem abria os filtros no
  telefone não via o começo deles, e nada indicava que bastava rolar para cima.
- Com a emulação ligada numa visita anterior, o filtro salvo a pedia mas nada disparava o
  carregamento no boot — e a lista aparecia **vazia**. Esse foi achado por acidente: um script de
  auditoria deixou o estado para trás e a suíte seguinte quebrou.

Por isso as asserções comparam contra `window.XBX_DB` recalculado na hora, e não contra
números fixos: se os dados mudarem, o teste continua válido.
