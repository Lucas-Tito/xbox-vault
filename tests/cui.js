// Area do CollectionUI, no fluxo da previa dele: a tela das colecoes, os jogos de
// uma colecao, e "Adicionar jogos" num rascunho com Concluir e Cancelar.
// Roda com a janela larga, como a suite. O arquivo de teste e montado aqui com
// Title IDs reais do catalogo, para nao depender do colecoes.txt de ninguem.
(async () => {
  const R = [];
  const ok = (n, c, d='') => R.push((c?'PASS':'FALL') + ' | ' + n + (d?' | '+d:''));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ate = async (f, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 100) await wait(100); };
  const G = window.XBX_DB.games;
  const comTid = G.filter(g => g.titleId);
  const a = comTid[0], b = comTid[1], c = comTid[2];
  const alt = G.find(g => g.titleIdAlt && g.titleIdAlt.length && g.id !== a.id && g.id !== b.id && g.id !== c.id);
  window.alert = () => {}; window.confirm = () => true;

  const importar = async txt => {
    const dt = new DataTransfer(); dt.items.add(new File([txt], 'colecoes.txt', {type:'text/plain'}));
    const inp = $('#file-cui'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true}));
    await ate(() => $('.cui-tile[data-col]')); await wait(200);
  };
  const exportar = async () => {
    let cap = null; const o = URL.createObjectURL;
    URL.createObjectURL = x => { cap = x; return o.call(URL, x); };
    $('#btn-cui-export').click(); await wait(300); URL.createObjectURL = o;
    return cap ? cap.text() : null;
  };
  const linha = (txt, nome) => txt.split('\r\n').find(l => l.indexOf('|' + nome + '|') > 0);
  const tile = nome => $$('.cui-tile[data-col]').find(t => t.querySelector('b').textContent === nome);
  const abrir = async nome => { tile(nome).click(); await wait(500); };
  const buscar = async q => { $('#q').value = q; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(600); };
  const card = g => $$('.card').find(x => x.dataset.id === g.id);
  // A coluna de filtros vira gaveta fixa em tela estreita, e elemento fixo nao tem
  // offsetParent: o que diz se ela existe na tela e o display.
  const filtros = () => getComputedStyle($('#side')).display !== 'none';

  // ---- troca de area ----
  $('.menu-item.area[data-area=cui]').click();
  await ate(() => window.XBX_XBLIG); await wait(400);
  ok('menu do nome leva ao CollectionUI', document.body.classList.contains('cui') && location.hash === '#collectionui');
  ok('a tela inicial e a das colecoes', document.body.dataset.tela === 'colecoes' && !!$('#cui-nova'));
  ok('sem filtros na tela das colecoes', !filtros());
  ok('os indies descem junto', !!window.XBX_XBLIG);
  ok('sem colecao, a barra explica o que fazer', /Nenhuma coleção/.test($('#cui-barra').textContent));

  // ---- importar: formato atual, uniao, CRLF, BOM ----
  const CAB = '# CollectionUI: uma colecao por linha, no formato\r\n' +
              '#   id, tipo, nome, conteudo -- separados por barra vertical\r\n' +
              '#   tipo jogos: TitleIds em hexa. tipo uniao: ids de colecao\r\n';
  const arq = CAB + '1|jogos|Zeta|' + a.titleId + ',' + b.titleId + ',0BD92375\r\n' +
                    '2|jogos|The Alfa|' + c.titleId + '\r\n' +
                    '3|uniao|Tudo|1,2\r\n';
  await importar('﻿' + arq);
  const nomes = $$('.cui-tile[data-col] b').map(x => x.textContent);
  ok('importa as tres colecoes', nomes.length === 3, nomes.join(', '));
  ok('ordem do console: sem artigo e sem caixa', nomes.join('|') === 'The Alfa|Tudo|Zeta', nomes.join('|'));
  ok('"Nova colecao" vem primeiro', $('.cui-grade').firstElementChild.id === 'cui-nova');
  ok('o quadrado traz a contagem', /\(\s*3\s*\)/.test(tile('Zeta').textContent), tile('Zeta').textContent);

  const ida = await exportar();
  ok('exportar sem mexer devolve o arquivo byte a byte (sem o BOM)', ida === arq, ida && ida.length + ' vs ' + arq.length);

  // ---- dentro de uma colecao: so os jogos dela ----
  await abrir('Zeta');
  ok('abrir mostra so os jogos da colecao', document.body.dataset.tela === 'jogos' &&
     $$('.card').length === 2 && !!card(a) && !!card(b), $$('.card').length + ' cards');
  ok('sem filtros dentro da colecao', !filtros());
  ok('id que o catalogo nao conhece aparece na barra', /0BD92375/.test($('#cui-barra').textContent));
  $('#cui-voltar').click(); await wait(400);
  await abrir('Tudo');
  ok('a uniao junta as origens', $$('.card').length === 3, $$('.card').length + ' cards');
  ok('a uniao nao tem Adicionar nem remover', !$('#cui-add') && !$('.rem-btn'));
  $('#cui-voltar').click(); await wait(400);

  // ---- adicionar: rascunho, apagados, Cancelar e Concluir ----
  await abrir('The Alfa');
  $('#cui-add').click(); await wait(600);
  ok('Adicionar abre o catalogo com os filtros', document.body.dataset.tela === 'adicionar' && !!filtros());
  await buscar(alt.title);
  const k = card(alt);
  ok('o jogo fora da colecao vem apagado', k && k.classList.contains('apagado'));
  k.click(); await wait(200);
  ok('marcar acende o jogo', k.classList.contains('nacol') && !k.classList.contains('apagado'));
  ok('a barra conta o marcado', /2 marcados/.test($('#cui-barra').textContent), $('#cui-barra').textContent.slice(0, 70));
  $('#cui-cancelar').click(); await wait(500);
  ok('Cancelar descarta o rascunho', linha(await exportar(), 'The Alfa') === '2|jogos|The Alfa|' + c.titleId);
  $('#cui-add').click(); await wait(600);
  await buscar(alt.title);
  card(alt).click(); await wait(200);
  $('#cui-concluir').click(); await wait(500);
  let l = linha(await exportar(), 'The Alfa');
  const ids = [alt.titleId].concat(alt.titleIdAlt).map(t => t.toUpperCase());
  ok('Concluir grava, com todos os Title IDs do jogo', ids.every(t => l.indexOf(t) > 0), l);
  ok('Concluir volta para a colecao', document.body.dataset.tela === 'jogos');

  // ---- remover pelo botao do card ----
  await buscar('');
  const rem = card(alt).querySelector('.rem-btn');
  rem.click(); await wait(300);
  ok('remover tira o jogo, com os alternativos', linha(await exportar(), 'The Alfa') === '2|jogos|The Alfa|' + c.titleId);
  ok('o card sai da tela', !card(alt));

  // ---- jogo sem Title ID nao entra ----
  $('#cui-add').click(); await wait(600);
  const sem = $$('.card.semtid')[0];
  if (sem) { sem.click(); await wait(200); ok('card sem Title ID nao marca', !sem.classList.contains('nacol')); }
  $('#cui-cancelar').click(); await wait(400);
  $('#cui-voltar').click(); await wait(400);

  // ---- nova colecao: nome saneado como no app (sem barra, 28 bytes) ----
  $('#cui-nova').click(); await wait(200);
  $('#cui-nome').value = 'Coop|ação para jogar em dois no sofá';
  $('#cui-ok').click(); await wait(500);
  const nova = (await exportar()).split('\r\n').find(x => x.startsWith('4|'));
  const nomeNovo = nova && nova.split('|')[2];
  ok('nova colecao ganha o proximo id e abre', !!nova && document.body.dataset.tela === 'jogos', nova);
  ok('nome sem barra e com ate 28 bytes', nomeNovo && nomeNovo.indexOf('|') < 0 && new TextEncoder().encode(nomeNovo).length <= 28,
     nomeNovo + ' = ' + (nomeNovo && new TextEncoder().encode(nomeNovo).length) + ' bytes');
  $('#cui-voltar').click(); await wait(400);

  // ---- apagar origem: a uniao perde a origem; sem origem nenhuma, some ----
  await abrir('Zeta'); $('#cui-apagar').click(); await wait(500);
  ok('apagar volta para as colecoes', document.body.dataset.tela === 'colecoes');
  ok('a uniao perde a origem apagada', (await exportar()).indexOf('3|uniao|Tudo|2\r\n') >= 0);
  await abrir('The Alfa'); $('#cui-apagar').click(); await wait(500);
  const aviso = $('#cui-barra').textContent;
  ok('uniao sem origem e apagada junto, com aviso', (await exportar()).indexOf('|uniao|') < 0 && /União apagada/.test(aviso),
     aviso.slice(0, 80));

  // ---- formato antigo "nome|TitleIds" ----
  await importar('Antiga|' + a.titleId.toLowerCase() + '\n');
  ok('formato antigo entra e sai no formato novo',
     (await exportar()).indexOf('1|jogos|Antiga|' + a.titleId.toUpperCase() + '\r\n') >= 0);

  // ---- volta ao catalogo ----
  $('.menu-item.area[data-area=cat]').click(); await wait(500);
  ok('volta ao catalogo', !document.body.classList.contains('cui') && location.hash === '' &&
     !!$('#vistas-own').offsetParent && !!filtros());
  localStorage.removeItem('xbx.cui.v1');
  return R;
})()
