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
  ok('o botao do topo passa a dizer CollectionUI', $('#brand-nome').textContent === 'CollectionUI');
  ok('a tela inicial e a das colecoes', document.body.dataset.tela === 'colecoes' && !!$('#cui-nova'));
  ok('sem filtros na tela das colecoes', !filtros());
  ok('os indies descem junto', !!window.XBX_XBLIG);
  ok('sem colecao, a barra explica o que fazer', /Nenhuma coleção/.test($('#cui-barra').textContent));

  // ---- importar: formato atual, uniao, CRLF, BOM ----
  const CAB = '# CollectionUI: uma colecao por linha, no formato\r\n' +
              '#   id, tipo, nome, conteudo -- separados por barra vertical\r\n' +
              '#   tipo jogos: TitleIds em hexa\r\n' +
              '#   tipo uniao e intersecao: ids de colecao, em decimal\r\n';
  const arq = CAB + '1|jogos|Zeta|' + a.titleId + ',' + b.titleId + ',0BD92375\r\n' +
                    '2|jogos|The Alfa|' + c.titleId + '\r\n' +
                    '3|uniao|Tudo|1,2\r\n';
  await importar('﻿' + arq);
  const nomes = $$('.cui-tile[data-col] b').map(x => x.textContent);
  ok('importa as tres colecoes', nomes.length === 3, nomes.join(', '));
  ok('ordem do console: sem artigo e sem caixa', nomes.join('|') === 'The Alfa|Tudo|Zeta', nomes.join('|'));
  ok('"Nova colecao" vem primeiro', $('.cui-grade').firstElementChild.id === 'cui-nova');
  ok('o quadrado traz a contagem', /\(\s*3\s*\)/.test(tile('Zeta').textContent), tile('Zeta').textContent);
  ok('a uniao mostra a contagem resolvida e o raio, sem a palavra uniao',
     /\(\s*4\s*\)/.test(tile('Tudo').textContent) && !/união/i.test($('.cui-grade').textContent) &&
     !!tile('Tudo').querySelector('.cui-emblema path') && !tile('Zeta').querySelector('.cui-emblema'),
     tile('Tudo').textContent);

  const ida = await exportar();
  ok('exportar sem mexer devolve o arquivo byte a byte (sem o BOM)', ida === arq, ida && ida.length + ' vs ' + arq.length);

  // ---- dentro de uma colecao: so os jogos dela ----
  await abrir('Zeta');
  ok('abrir mostra so os jogos da colecao', document.body.dataset.tela === 'jogos' &&
     $$('.card').length === 2 && !!card(a) && !!card(b), $$('.card').length + ' cards');
  ok('sem filtros dentro da colecao', !filtros());
  ok('dentro da colecao nao agrupa por ano', $$('.year').length === 0, $$('.year').length + ' anos');
  ok('id que o catalogo nao conhece aparece na barra', /0BD92375/.test($('#cui-barra').textContent));
  $('#cui-voltar').click(); await wait(400);
  await abrir('Tudo');
  ok('a uniao junta as origens', $$('.card').length === 3, $$('.card').length + ' cards');
  const titulos = $$('.card h3').map(h => h.textContent.toLowerCase().replace(/^(the|a|an|o|os|as|um|uma) /, ''));
  ok('dentro da colecao a ordem e alfabetica, sem artigo', titulos.every((t, i) => !i || titulos[i - 1] <= t),
     titulos.join(' | '));
  ok('a uniao nao tem Adicionar nem remover', !$('#cui-add') && !$('.rem-btn'));
  ok('tem a seta de voltar ao lado da trilha', !!$('.cui-seta'));
  $('#cui-voltar').click(); await wait(400);

  // ---- adicionar: rascunho, apagados, Cancelar e Concluir ----
  await abrir('The Alfa');
  $('#cui-add').click(); await wait(600);
  ok('Adicionar abre o catalogo com os filtros', document.body.dataset.tela === 'adicionar' && !!filtros());
  ok('as abas do catalogo aparecem ao adicionar', !!$('#vistas-own').offsetParent);
  $('.vista[data-own="yes"]').click(); await wait(500);
  ok('a aba Tenho filtra o rascunho', $$('.card').length === 0 && /Nenhum jogo/.test($('#main').textContent),
     $$('.card').length + ' cards');
  $('.vista[data-own="all"]').click(); await wait(500);
  await buscar(alt.title);
  const k = card(alt);
  ok('o jogo fora da colecao vem apagado', k && k.classList.contains('apagado'));
  k.querySelector('.info-btn').click(); await wait(300);
  ok('o botao de ficha abre a ficha e nao marca', !$('#modal').hidden && $('.sheet').classList.contains('sheet--det') &&
     k.classList.contains('apagado') && /(^|\D)1 marcado(?!s)/.test($('#cui-barra').textContent),
     [!$('#modal').hidden, $('.sheet').className, k.className].join(' / '));
  $('#modal').click(); await wait(200);
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
  ok('aparece o aviso com Desfazer', !$('#aviso').hidden && /removido/.test($('#aviso-txt').textContent));
  const antesDesfazer = linha(await exportar(), 'The Alfa');
  // poe de novo para testar o Desfazer devolvendo a lista exatamente como estava
  $('#cui-add').click(); await wait(600); await buscar(alt.title);
  card(alt).click(); await wait(200); $('#cui-concluir').click(); await wait(500); await buscar('');
  const comJogo = linha(await exportar(), 'The Alfa');
  card(alt).querySelector('.rem-btn').click(); await wait(300);
  $('#aviso-desfazer').click(); await wait(500);
  ok('Desfazer devolve a colecao exatamente como estava', linha(await exportar(), 'The Alfa') === comJogo && !!card(alt),
     comJogo);
  ok('o aviso some depois de desfazer', $('#aviso').hidden);
  card(alt).querySelector('.rem-btn').click(); await wait(300);
  ok('remover de novo deixa como antes', linha(await exportar(), 'The Alfa') === antesDesfazer);

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
  const nova = (await exportar()).split('\r\n').find(x => /^\d+\|jogos\|Coop/.test(x) && !/^[123]\|/.test(x));
  const nomeNovo = nova && nova.split('|')[2];
  ok('nova colecao ganha id sorteado (fora dos que existiam) e abre', !!nova && document.body.dataset.tela === 'jogos', nova);
  ok('nome sem barra e com ate 28 bytes', nomeNovo && nomeNovo.indexOf('|') < 0 && new TextEncoder().encode(nomeNovo).length <= 28,
     nomeNovo + ' = ' + (nomeNovo && new TextEncoder().encode(nomeNovo).length) + ' bytes');
  $('#cui-voltar').click(); await wait(400);

  // ---- apagar origem: a uniao perde a origem; sem origem nenhuma, some ----
  await abrir('Zeta'); $('#cui-apagar').click(); await wait(500);
  ok('apagar volta para as colecoes', document.body.dataset.tela === 'colecoes');
  ok('a uniao perde a origem apagada', (await exportar()).indexOf('3|uniao|Tudo|2\r\n') >= 0);
  await abrir('The Alfa'); $('#cui-apagar').click(); await wait(500);
  const aviso = $('#cui-barra').textContent;
  ok('uniao sem origem e apagada junto, com aviso', (await exportar()).indexOf('|uniao|') < 0 && /Apagada junto/.test(aviso),
     aviso.slice(0, 80));

  // ---- intersecao: so o que esta em todas; origem morta esvazia, nao alarga ----
  const arqX = CAB + '1|jogos|Zeta|' + a.titleId + ',' + b.titleId + '\r\n' +
                     '2|jogos|Alfa|' + b.titleId + ',' + c.titleId + '\r\n' +
                     '3|uniao|Tudo|1,2\r\n' +
                     '4|intersecao|Cruz|1,3\r\n' +
                     '5|intersecao|Morta|2,99\r\n' +
                     '6|intersecao|Errada|4\r\n' +
                     '7|futuro|Tipo novo|x,y\r\n';
  await importar(arqX);
  ok('tipo desconhecido nao vira colecao', !tile('Tipo novo') && $$('.cui-tile[data-col]').length === 6,
     $$('.cui-tile[data-col] b').map(x => x.textContent).join(', '));
  ok('a intersecao conta so o que esta em todas, com a lente', /\(\s*2\s*\)/.test(tile('Cruz').textContent) &&
     tile('Cruz').querySelectorAll('.cui-emblema circle').length === 2, tile('Cruz').textContent);
  ok('intersecao com origem morta fica vazia', /\(\s*0\s*\)/.test(tile('Morta').textContent), tile('Morta').textContent);
  ok('intersecao de intersecao fica vazia', /\(\s*0\s*\)/.test(tile('Errada').textContent), tile('Errada').textContent);
  ok('exportar devolve tudo como veio, a linha desconhecida inclusive', (await exportar()) === arqX);
  await abrir('Cruz');
  ok('dentro da intersecao: os jogos e a regra no cabecalho', $$('.card').length === 2 && !!card(a) && !!card(b) &&
     /em todas: Zeta, Tudo/.test($('#cui-barra').textContent) && !$('#cui-add'), $('#cui-barra').textContent.slice(0, 120));
  $('#cui-voltar').click(); await wait(400);
  await abrir('Morta');
  ok('a origem morta e explicada na barra', /não existe mais/.test($('#cui-barra').textContent));
  $('#cui-voltar').click(); await wait(400);
  await abrir('Zeta'); $('#cui-apagar').click(); await wait(500);
  const semZeta = await exportar();
  ok('apagar uma origem: a uniao encolhe, a intersecao fica com a origem e vazia',
     semZeta.indexOf('\r\n3|uniao|Tudo|2\r\n') > 0 && semZeta.indexOf('\r\n4|intersecao|Cruz|1,3\r\n') > 0 &&
     /\(\s*0\s*\)/.test(tile('Cruz').textContent), semZeta);

  // ---- nova intersecao pelo formulario, com a contagem ao vivo ----
  $('#cui-nova').click(); await wait(200);
  $('#cui-nome').value = 'Cruzada';
  const rx = $('input[name=cui-tipo][value=intersecao]'); rx.checked = true; rx.dispatchEvent(new Event('change'));
  await wait(100);
  const opc = $$('.cui-origem').map(x => +x.value);
  ok('a intersecao so oferece manual e juncao como origem', opc.length === 2 && opc.indexOf(2) >= 0 && opc.indexOf(3) >= 0,
     opc.join(','));
  $$('.cui-origem').forEach(x => { x.checked = true; x.dispatchEvent(new Event('change')); });
  ok('o formulario diz quantos jogos daria', /Daria 2 jogos/.test($('#cui-daria').textContent), $('#cui-daria').textContent);
  $('#cui-ok').click(); await wait(500);
  ok('a intersecao criada vai para o arquivo', (await exportar()).split('\r\n').some(x => /^\d+\|intersecao\|Cruzada\|(2,3|3,2)$/.test(x)));
  $('#cui-voltar').click(); await wait(400);

  // ---- id da linha guardada fica reservado ----
  await importar(CAB + '1|jogos|Z|' + a.titleId + '\r\n2|uniao|U|1\r\n1|futuro|X|\r\n');
  const colide = (await exportar()).split('\r\n');
  const zId = (colide.find(x => /\|jogos\|Z\|/.test(x)) || '').split('|')[0];
  ok('colecao com o id de uma linha guardada e renumerada, e a uniao vai junto',
     zId && zId !== '1' && colide.indexOf('2|uniao|U|' + zId) > 0 && colide.indexOf('1|futuro|X|') > 0, colide.join(' / '));

  // ---- formato antigo "nome|TitleIds" ----
  await importar('Antiga|' + a.titleId.toLowerCase() + '\n');
  ok('formato antigo entra e sai no formato novo',
     (await exportar()).split('\r\n').some(l => new RegExp('^[1-9]\\d*\\|jogos\\|Antiga\\|' + a.titleId.toUpperCase() + '$').test(l)));

  // ---- a leitura e a do Carregar do console: nada some em silencio ----
  const arq2 = CAB +
    '#1 favoritos|' + a.titleId + '\r\n' +                        // antigo comecando com #
    '7|jogos|Cortada\r\n' +                                         // cortada no meio
    '1942|' + b.titleId + '\r\n' +                                  // antigo que comeca com numero
    '7|jogos|Repetida|' + c.titleId + '\r\n' +                      // id repetido
    '0|jogos|Zero|' + c.titleId + ',' + c.titleId + ',4D53082Dx\r\n' +  // id 0, TID repetido, lixo
    '8|jogos|Um nome comprido que passa de vinte e oito bytes|' + a.titleId + '\r\n';
  await importar(arq2);
  const avisoImport = $('#cui-barra').textContent;
  const ls = (await exportar()).split('\r\n');
  const T = x => x.toUpperCase();
  ok('"#" no comeco nao e comentario', ls.some(l => /^\d+\|jogos\|#1 favoritos\|/.test(l)), ls.join(' / '));
  ok('linha cortada fica, sem conteudo', ls.includes('7|jogos|Cortada|'));
  ok('"1942|..." e o formato antigo', ls.some(l => /^\d+\|jogos\|1942\|/.test(l) && l.endsWith('|' + T(b.titleId))));
  ok('id repetido: a primeira fica com ele, a segunda ganha id novo', ls.includes('7|jogos|Cortada|') &&
     ls.some(l => !l.startsWith('7|') && /\|jogos\|Repetida\|/.test(l)));
  ok('o id renumerado vira aviso', /Repetida" tinha o id 7 repetido/.test(avisoImport), avisoImport.slice(0, 120));
  ok('id 0 ganha id novo; Title ID repetido fica; lixo depois do hexa sai',
     ls.some(l => !l.startsWith('0|') && /\|jogos\|Zero\|/.test(l) &&
       l.endsWith('|' + T(c.titleId) + ',' + T(c.titleId) + ',4D53082D')));
  ok('nome importado passa pelo Sanear (28 bytes)', ls.some(l => {
       const p = l.split('|'); return p[0] === '8' && new TextEncoder().encode(p[2]).length <= 28 && p[2].startsWith('Um nome'); }));
  ok('a ordem do arquivo fica', ls.findIndex(l => /#1 favoritos/.test(l)) < ls.findIndex(l => /Cortada/.test(l)) &&
     ls.findIndex(l => /Cortada/.test(l)) < ls.findIndex(l => /\|1942\|/.test(l)));

  // ---- vault.txt: inventario do console e colecoes num arquivo so ----
  // O id da ROM calculado aqui de novo, a parte, com a minuscula do console.
  const fnv = (emu, nome) => {
    let h = (2166136261 ^ emu) >>> 0;
    for (let x of new TextEncoder().encode(nome)) {
      if ((x >= 0x41 && x <= 0x5A) || (x >= 0xC0 && x <= 0xDE && x !== 0xD7)) x += 32;
      h = Math.imul((h ^ x) >>> 0, 16777619) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0');
  };
  const rom = fnv(0xFFED0707, 'Jogo Teste.SMC');
  const VCAB = '# CollectionUI: inventario deste console, para o xbox-vault\r\n' +
               '#   tipo|id|contentType|emulador|item|nome|arquivo\r\n' +
               '#   COLECAO|id|tipo|nome|conteudo\r\n';
  const vault = (rodape, idRom = rom) => VCAB +
    'JOGO|' + T(a.titleId) + '|00007000||00000001|' + a.title + '|\\JOGOS\\A\\GAME\\default.xex\r\n' +
    'JOGO|' + T(a.titleId) + '|00007000||00000002|' + a.title + '|\\JOGOS\\A\\DISC2\\default.xex\r\n' +
    'JOGO|7E570001|00007000||00000003|Só Do Console™|\\JOGOS\\SO CONSOLE\\default.xex\r\n' +
    'JOGO|00000000|00007000||00000004|Homebrew Zero|\\HOMEBREW\\HZ\\hz.xex\r\n' +
    'JOGO|FFED0707|00007000||00000005|Snes360|\\HOMEBREW\\Snes360\\default.xex\r\n' +
    'ROM|' + idRom + '|00007000|FFED0707||Jogo Teste|Jogo Teste.SMC\r\n' +
    'COLECAO|11|jogos|Do console|' + T(a.titleId) + ',7E570001,' + idRom + ',' + T(c.titleId) + '\r\n' +
    'COLECAO|12|uniao|Uniao|11\r\n' +
    (rodape === undefined ? '# total: 5 jogos, 1 ROMs, 2 colecoes\r\n' : rodape);
  const alertas = []; window.alert = m => alertas.push(m);
  const antesVault = await exportar();
  await importar(vault(''));
  ok('vault.txt sem o rodape: avisa e nao troca nada', /linha de total/.test(alertas.pop() || '') &&
     (await exportar()) === antesVault);
  await importar(vault('# total: 6 jogos, 1 ROMs, 2 colecoes\r\n'));
  ok('rodape que nao bate: avisa e nao troca nada', /diz ter 6 jogos/.test(alertas.pop() || '') &&
     (await exportar()) === antesVault);
  await importar(vault());
  await ate(() => tile('Do console'));
  ok('vault.txt traz as colecoes', !!tile('Do console') && !!tile('Uniao') && $$('.cui-tile[data-col]').length === 2,
     $$('.cui-tile[data-col] b').map(x => x.textContent).join(', '));
  ok('linha de comentario com barra nao vira jogo nem colecao', alertas.length === 0, alertas.join(' / '));
  ok('a barra diz o que veio do console', /Console: 5 jogos e 1 ROM, importados em/.test($('#cui-barra').textContent),
     $('#cui-barra').textContent.slice(0, 90));
  ok('dois discos com o mesmo Title ID contam como dois itens', /\(\s*5\s*\)/.test(tile('Do console').textContent),
     tile('Do console').textContent);
  const saida = await exportar();
  ok('exportar continua gerando so o colecoes.txt', saida === CAB + '11|jogos|Do console|' + T(a.titleId) + ',7E570001,' +
     rom + ',' + T(c.titleId) + '\r\n12|uniao|Uniao|11\r\n', saida);

  const porId = id => $$('.card').find(x => x.dataset.id === id);
  await abrir('Do console');
  ok('dentro da colecao: um card por item do console, e o do catalogo', $$('.card').length === 5,
     $$('.card h3').map(h => h.textContent).join(' | '));
  ok('os dois discos aparecem, cada um dizendo que vem junto com o outro',
     /DISC2/.test((porId('con-J00000001') || document.body).querySelector('.cui-junto')?.textContent || '') &&
     /GAME/.test((porId('con-J00000002') || document.body).querySelector('.cui-junto')?.textContent || ''));
  ok('o que o catalogo nao conhece aparece com o nome do console',
     /Só Do Console™/.test((porId('con-J00000003') || document.body).textContent) && !!porId('con-R' + rom));
  ok('o jogo da colecao que nao esta no console fica marcado como fora',
     !!card(c) && card(c).classList.contains('fora') && /FORA DO CONSOLE/.test(card(c).textContent));
  ok('a ROM traz o emulador', /ROM · Snes360/.test((porId('con-R' + rom) || document.body).textContent));

  $('#cui-add').click(); await wait(700);
  ok('Adicionar abre na aba No console', !$('#vista-con').hidden &&
     $('.vista[aria-selected=true]').dataset.own === 'console' && $('#s-con').textContent === '6');
  ok('No console mostra so o que veio do console', $$('.card').every(x => x.dataset.id.startsWith('con-')) &&
     !!porId('con-J00000003'), $$('.card').map(x => x.dataset.id).join(' '));
  ok('o item do console que o catalogo conhece tem ficha; o que so o console conhece, nao',
     !!porId('con-J00000001').querySelector('.info-btn') && !porId('con-J00000003').querySelector('.info-btn'));
  porId('con-J00000001').querySelector('.info-btn').click(); await wait(300);
  ok('a ficha do item do console e a do jogo do catalogo', !$('#modal').hidden &&
     $('#modal-body').textContent.indexOf(a.title) >= 0 && porId('con-J00000001').classList.contains('nacol'));
  $('#modal').click(); await wait(200);
  porId('con-J00000001').click(); await wait(200);
  ok('desmarcar um disco desmarca o outro, que divide o Title ID',
     porId('con-J00000001').classList.contains('apagado') && porId('con-J00000002').classList.contains('apagado'));
  porId('con-J00000002').click(); await wait(200);
  ok('marcar o outro acende os dois', porId('con-J00000001').classList.contains('nacol') &&
     porId('con-J00000002').classList.contains('nacol'));
  porId('con-J00000001').click(); await wait(200);   // tira os dois discos de novo
  ok('a aba Fora da colecao aparece, contando o que falta por', !$('#vista-fora').hidden &&
     $('#s-fora').textContent === '3', $('#s-fora').textContent);
  $('#vista-fora').click(); await wait(500);
  ok('Fora da colecao: so o do console que nao esta nela',
     $$('.card').map(x => x.dataset.id).sort().join(' ') === 'con-J00000001 con-J00000002',
     $$('.card').map(x => x.dataset.id).join(' '));
  ok('Fora da colecao nao repete a etiqueta NO CONSOLE', !/NO CONSOLE/.test($('#main').textContent));
  porId('con-J00000001').click(); await wait(200);
  ok('marcar ali nao some com o card, e a contagem desce', !!porId('con-J00000001') &&
     porId('con-J00000002').classList.contains('nacol') && $('#s-fora').textContent === '1', $('#s-fora').textContent);
  $('#vista-fora').click(); await wait(500);
  ok('reabrir a aba tira o que entrou', $$('.card').length === 0, $$('.card').length + ' cards');
  $('.vista[data-own="all"]').click(); await wait(500);
  await buscar(a.title);
  ok('nas abas do catalogo o que esta no console ganha NO CONSOLE',
     /NO CONSOLE/.test((porId('con-J00000001') || document.body).querySelector('.tags')?.textContent || '') &&
     !card(a), $$('.card').map(x => x.dataset.id).join(' '));
  await buscar('');
  $('#cui-cancelar').click(); await wait(500);
  ok('ao sair do Adicionar a aba do catalogo volta', $('#vista-con').hidden &&
     $('.vista[aria-selected=true]')?.dataset.own !== 'console');

  porId('con-J00000002').querySelector('.rem-btn').click(); await wait(500);
  ok('remover um disco tira os dois', !porId('con-J00000001') && !porId('con-J00000002') &&
     linha(await exportar(), 'Do console') === '11|jogos|Do console|7E570001,' + rom + ',' + T(c.titleId));
  $('#cui-voltar').click(); await wait(400);

  // ---- Biblioteca: passear pelo console e distribuir pelas colecoes ----
  $('#cui-nova').click(); await wait(200);
  $('#cui-nome').value = 'Outra'; $('#cui-ok').click(); await wait(500);
  $('#cui-voltar').click(); await wait(400);
  ok('a tela das colecoes tem o botao Biblioteca', !!$('#cui-bib'));
  $('#cui-bib').click(); await wait(600);
  ok('a Biblioteca abre no console, com filtros e as abas dela', document.body.dataset.tela === 'biblioteca' && !!filtros() &&
     $('.vista[aria-selected=true]').dataset.own === 'console' && !$('#vista-semcol').hidden && $('#vista-fora').hidden);
  ok('Sem colecao conta o do console fora de toda colecao', $('#s-semcol').textContent === '3', $('#s-semcol').textContent);
  const cols = k => k.querySelectorAll('.tag').length && [...k.querySelectorAll('.tags.cui-em .tag')].map(t => t.textContent).join(', ');
  ok('na Biblioteca as etiquetas do card sao as colecoes dele', cols(porId('con-J00000003')) === 'Do console, Uniao' &&
     porId('con-J00000003').querySelectorAll('.tag').length === 2, cols(porId('con-J00000003')));
  $('#vista-semcol').click(); await wait(500);
  ok('a aba Sem colecao mostra so o que nao esta em nenhuma',
     $$('.card').map(x => x.dataset.id).sort().join(' ') === 'con-J00000001 con-J00000002', $$('.card').map(x => x.dataset.id).join(' '));
  porId('con-J00000001').click(); await wait(400);
  const caixas = $$('#modal-body .cui-vinc');
  ok('a ficha traz as colecoes manuais, desmarcadas', caixas.length === 2 && caixas.every(x => !x.checked),
     caixas.map(x => x.parentNode.textContent).join(','));
  const outra = caixas.find(x => /Outra/.test(x.parentNode.textContent));
  outra.click(); await wait(300);
  ok('marcar na ficha grava na hora', (linha(await exportar(), 'Outra') || '').indexOf(T(a.titleId)) > 0 &&
     $$('#modal-body .cui-vinc').find(x => /Outra/.test(x.parentNode.textContent)).checked, linha(await exportar(), 'Outra'));
  $('#modal').click(); await wait(200);
  ok('o card fica na aba e os dois discos dizem a colecao', !!porId('con-J00000001') &&
     cols(porId('con-J00000002')) === 'Outra' && $('#s-semcol').textContent === '1',
     cols(porId('con-J00000002')) + ' / ' + $('#s-semcol').textContent);
  const antesDoMais = linha(await exportar(), 'Do console');
  porId('con-J00000002').querySelector('.vinc-btn').click(); await wait(200);
  const pop = $('#cui-pop');
  ok('o + abre a lista, com a colecao em que ja esta marcada', !!pop &&
     $$('#cui-pop .cui-vinc').filter(x => x.checked).map(x => x.parentNode.textContent.trim()).join() === 'Outra');
  $$('#cui-pop .cui-vinc').find(x => /Do console/.test(x.parentNode.textContent)).click(); await wait(300);
  ok('marcar no + poe o jogo em mais uma colecao', (linha(await exportar(), 'Do console') || '').indexOf(T(a.titleId)) > 0 &&
     /entrou em Do console/.test($('#aviso-txt').textContent) &&
     cols(porId('con-J00000001')) === 'Do console, Outra, Uniao',
     cols(porId('con-J00000001')));
  $('#aviso-desfazer').click(); await wait(300);
  ok('Desfazer tira de novo', linha(await exportar(), 'Do console') === antesDoMais &&
     cols(porId('con-J00000001')) === 'Outra');
  document.body.click(); await wait(100);
  ok('clicar fora fecha a lista', !$('#cui-pop'));
  $('#vista-semcol').click(); await wait(500);
  ok('reabrir Sem colecao tira o que entrou', $$('.card').length === 0, $$('.card').length + ' cards');
  $('#cui-voltar').click(); await wait(400);
  ok('sair da Biblioteca devolve a aba do catalogo', document.body.dataset.tela === 'colecoes' &&
     ['console', 'semcol'].indexOf(($('.vista[aria-selected=true]') || {dataset: {}}).dataset.own) < 0);

  await importar(vault(undefined, 'DEADBEEF'));
  ok('ROM com id que nao bate com o arquivo vira aviso', /1 ROM com id que não bate/.test($('#cui-barra').textContent),
     $('#cui-barra').textContent.slice(0, 160));
  // ---- APP: homebrew sem Title ID, com id sintetico do caminho ----
  const fnvApp = s => {
    let h = 2166136261 >>> 0;
    for (let x of new TextEncoder().encode(s)) { if (x >= 0x41 && x <= 0x5A) x += 32; h = Math.imul(h ^ x, 16777619) >>> 0; }
    return ('0000000' + (h || 1).toString(16).toUpperCase()).slice(-8);
  };
  const caminho = '\\HOMEBREW\\Raw360\\Raw360.xex', idApp = fnvApp(caminho);
  const comApp = VCAB + 'JOGO|' + T(a.titleId) + '|00007000||00000001|' + a.title + '|\\JOGOS\\A\\GAME\\default.xex\r\n' +
    'APP|' + idApp + '|00007000||00000029|Another World|' + caminho + '\r\n' +
    'COLECAO|11|jogos|Com app|' + T(a.titleId) + '\r\n' +
    '# total: 1 jogos, 1 apps, 0 ROMs, 1 colecoes\r\n';
  await importar(comApp);
  await ate(() => tile('Com app'));
  ok('vault.txt com APP entra, e a barra conta o app a parte', /Console: 1 jogo, 1 app e 0 ROMs/.test($('#cui-barra').textContent),
     $('#cui-barra').textContent.slice(0, 160));
  ok('o id do app confere com o caminho', !/app com id/.test($('#cui-barra').textContent));
  const antesApp = await exportar();
  await importar(comApp.replace('1 apps', '2 apps'));
  ok('rodape com a conta de apps errada: avisa e nao troca nada', /2 apps/.test(alertas.pop() || '') &&
     (await exportar()) === antesApp);
  const hb = $$('.f-plat').find(x => x.value === 'homebrew');
  hb.checked = true; hb.dispatchEvent(new Event('change', {bubbles:true})); await ate(() => window.XBX_HB); await wait(400);
  await abrir('Com app');
  $('#cui-add').click(); await wait(600);
  const kApp = porId('con-J00000029');
  ok('o app aparece no console como homebrew, e pode entrar em colecao', !!kApp && !kApp.classList.contains('semtid') &&
     kApp.classList.contains('apagado'), kApp ? kApp.className : $$('.card').map(x => x.dataset.id).join(' '));
  kApp.click(); await wait(200);
  $('#cui-concluir').click(); await wait(500);
  ok('o id do app vai para o colecoes.txt', linha(await exportar(), 'Com app') === '11|jogos|Com app|' + T(a.titleId) + ',' + idApp);
  hb.checked = false; hb.dispatchEvent(new Event('change', {bubbles:true})); await wait(400);
  $('#cui-voltar').click(); await wait(400);
  localStorage.removeItem('xbx.cui.inv.v1');

  // ---- volta ao catalogo ----
  $('.menu-item.area[data-area=cat]').click(); await wait(500);
  ok('o botao do topo volta a dizer Xbox Vault', $('#brand-nome').textContent === 'Xbox Vault');
  ok('volta ao catalogo', !document.body.classList.contains('cui') && location.hash === '' &&
     !!$('#vistas-own').offsetParent && !!filtros());
  localStorage.removeItem('xbx.cui.v1');
  return R;
})()
