// Area do CollectionUI: montar as colecoes do console em cima do catalogo.
// Roda com a janela larga, como a suite. O arquivo de teste e montado aqui com
// Title IDs reais do catalogo, para nao depender do colecoes.txt de ninguem.
(async () => {
  const R = [];
  const ok = (n, c, d='') => R.push((c?'PASS':'FALL') + ' | ' + n + (d?' | '+d:''));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const G = window.XBX_DB.games;
  const comTid = G.filter(g => g.titleId);
  const a = comTid[0], b = comTid[1], c = comTid[2];
  const alt = G.find(g => g.titleIdAlt && g.titleIdAlt.length);
  window.alert = () => {}; window.confirm = () => true;

  const importar = async txt => {
    const dt = new DataTransfer(); dt.items.add(new File([txt], 'colecoes.txt', {type:'text/plain'}));
    const inp = $('#file-cui'); inp.files = dt.files; inp.dispatchEvent(new Event('change', {bubbles:true}));
    await wait(700);
  };
  const exportar = async () => {
    let cap = null; const o = URL.createObjectURL;
    URL.createObjectURL = x => { cap = x; return o.call(URL, x); };
    $('#btn-cui-export').click(); await wait(300); URL.createObjectURL = o;
    return cap ? cap.text() : null;
  };
  const aba = nome => $$('#cui-abas [data-col]').find(x => x.firstChild.textContent === nome);

  // ---- troca de area ----
  $('.menu-item.area[data-area=cui]').click(); await wait(500);
  ok('menu do nome leva ao CollectionUI', document.body.classList.contains('cui') && location.hash === '#collectionui');
  ok('as abas do catalogo somem', !$('#vistas-own').offsetParent && !!$('#cui-abas').offsetParent);
  ok('o Arquivo troca de itens', !$('#btn-export').offsetParent === true && $('#btn-cui-import').closest('.menu-lista') !== null);
  ok('sem colecao, a barra explica o que fazer', /Nenhuma coleção/.test($('#cui-barra').textContent));
  ok('"+ Nova" e a primeira aba', $('#cui-abas .vista') && $('#cui-abas .vista').id === 'cui-nova');

  // ---- importar: formato atual, uniao, CRLF, BOM ----
  const CAB = '# CollectionUI: uma colecao por linha, no formato\r\n' +
              '#   id, tipo, nome, conteudo -- separados por barra vertical\r\n' +
              '#   tipo jogos: TitleIds em hexa. tipo uniao: ids de colecao\r\n';
  const arq = CAB + '1|jogos|Zeta|' + a.titleId + ',' + b.titleId + ',0BD92375\r\n' +
                    '2|jogos|The Alfa|' + c.titleId + '\r\n' +
                    '3|uniao|Tudo|1,2\r\n';
  await importar('﻿' + arq);
  const nomes = $$('#cui-abas [data-col]').map(x => x.firstChild.textContent);
  ok('importa as tres colecoes', nomes.length === 3, nomes.join(', '));
  ok('ordem do console: sem artigo e sem caixa', nomes.join('|') === 'The Alfa|Tudo|Zeta', nomes.join('|'));
  aba('Zeta').click(); await wait(400);
  // "Da colecao" mostra so os dela: o jogo pode estar longe do primeiro lote da grade
  const daCol = $('input[name=cui-vista][value=colecao]'); daCol.checked = true;
  daCol.dispatchEvent(new Event('change', {bubbles:true})); await wait(500);
  ok('o jogo da colecao acende', !!$$('.card.nacol').find(x => x.dataset.id === a.id));
  ok('"Da colecao" mostra so os dela', $$('.card').length === 2 && $$('.card.nacol').length === 2, $$('.card').length + ' cards');
  const todos = $('input[name=cui-vista][value=todos]'); todos.checked = true;
  todos.dispatchEvent(new Event('change', {bubbles:true})); await wait(500);
  ok('id que o catalogo nao conhece aparece na barra', /0BD92375/.test($('#cui-barra').textContent));
  aba('Tudo').click(); await wait(400);
  ok('a uniao junta as origens', /3 jogos|4 jogos/.test($('#cui-barra').textContent), $('#cui-barra').textContent.slice(0, 60));

  // ---- exportar sem mudar nada devolve o mesmo arquivo ----
  const ida = await exportar();
  ok('exportar devolve o arquivo byte a byte (sem o BOM)', ida === arq, ida && ida.length + ' vs ' + arq.length);

  // ---- clique poe e tira, com todos os Title IDs do jogo ----
  aba('The Alfa').click(); await wait(400);
  if (alt) {
    $('#q').value = alt.title; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(700);
  }
  const alvo = alt ? $$('.card').find(x => x.dataset.id === alt.id) : $$('.card:not(.nacol):not(.semtid)')[0];
  alvo.click(); await wait(300);
  ok('clicar poe o jogo na colecao', alvo.classList.contains('nacol'));
  let txt = await exportar();
  const linha = txt.split('\r\n').find(l => l.indexOf('|The Alfa|') > 0);
  const ids = alt ? [alt.titleId].concat(alt.titleIdAlt) : [];
  ok('entram todos os Title IDs do jogo', ids.every(t => linha.indexOf(t.toUpperCase()) > 0), linha);
  alvo.click(); await wait(300);
  txt = await exportar();
  ok('clicar de novo tira, com os alternativos', txt.split('\r\n').find(l => l.indexOf('|The Alfa|') > 0) === '2|jogos|The Alfa|' + c.titleId);
  $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(600);

  // ---- jogo sem Title ID nao entra ----
  const sem = $$('.card.semtid')[0];
  if (sem) {
    const antes = await exportar(); sem.click(); await wait(200);
    ok('card sem Title ID nao entra', (await exportar()) === antes);
  }

  // ---- nova colecao: nome saneado como no app (sem barra, 28 bytes) ----
  $('#cui-nova').click(); await wait(200);
  $('#cui-nome').value = 'Coop|ação para jogar em dois no sofá';
  $('#cui-ok').click(); await wait(400);
  txt = await exportar();
  const nova = txt.split('\r\n').find(l => l.startsWith('4|'));
  const nomeNovo = nova && nova.split('|')[2];
  ok('nova colecao ganha o proximo id', !!nova, nova);
  ok('nome sem barra e com ate 28 bytes', nomeNovo && nomeNovo.indexOf('|') < 0 && new TextEncoder().encode(nomeNovo).length <= 28,
     nomeNovo + ' = ' + (nomeNovo && new TextEncoder().encode(nomeNovo).length) + ' bytes');

  // ---- apagar origem: a uniao perde a origem; sem origem nenhuma, some ----
  aba('Zeta').click(); await wait(300); $('#cui-apagar').click(); await wait(400);
  txt = await exportar();
  ok('a uniao perde a origem apagada', txt.indexOf('3|uniao|Tudo|2\r\n') >= 0);
  aba('The Alfa').click(); await wait(300); $('#cui-apagar').click(); await wait(400);
  const aviso = $('#cui-barra').textContent;
  txt = await exportar();
  ok('uniao sem origem e apagada junto, com aviso', txt.indexOf('|uniao|') < 0 && /União apagada/.test(aviso), aviso.slice(0, 80));

  // ---- formato antigo "nome|TitleIds" ----
  await importar('Antiga|' + a.titleId.toLowerCase() + '\n');
  txt = await exportar();
  ok('formato antigo entra e sai no formato novo', txt.indexOf('1|jogos|Antiga|' + a.titleId.toUpperCase() + '\r\n') >= 0);

  // ---- volta ao catalogo ----
  $('.menu-item.area[data-area=cat]').click(); await wait(500);
  ok('volta ao catalogo', !document.body.classList.contains('cui') && location.hash === '' && !!$('#vistas-own').offsetParent);
  localStorage.removeItem('xbx.cui.v1');
  return R;
})()
