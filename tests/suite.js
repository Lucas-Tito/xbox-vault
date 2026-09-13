(() => {
  const R = [];
  const ok = (n, c, d='') => R.push((c?'PASS':'FALL') + ' | ' + n + (d?' | '+d:''));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cards = () => $$('.card');
  const fire = (el, t='change') => el.dispatchEvent(new Event(t, {bubbles:true}));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // espera condicional: evita flake quando a rede esta lenta (CDN frio apos deploy)
  const until = async (fn, ms = 6000, step = 100) => {
    for (let t = 0; t < ms; t += step) { if (fn()) return true; await wait(step); }
    return false;
  };

  return (async () => {
    // estado de visita anterior nao pode vazar entre execucoes do teste
    ok('catalogo carregou', window.XBX_DB.games.length > 3000, window.XBX_DB.games.length + ' jogos');
    ok('stats total confere', $('#s-total').textContent.replace(/\D/g,'') == window.XBX_DB.games.length, $('#s-total').textContent);
    ok('cards renderizaram', cards().length > 50, cards().length + ' cards no 1o lote');
    ok('secoes de ano', $$('.year').length > 0, $$('.year').length + ' secoes');

    // filtro de plataforma: so xbox original
    $$('.f-plat').forEach(c => { c.checked = (c.value === 'xbox'); fire(c); });
    await wait(400);
    const ids = cards().map(c => c.dataset.id);
    ok('filtro plataforma', ids.length > 0 && ids.every(i => i.startsWith('xbox-')), ids.length + ' cards, todos xbox-');

    // filtro de retrocompatibilidade
    $('#f-bc').value = 'yes'; fire($('#f-bc')); await wait(400);
    const bcShown = +$('#s-shown').textContent.replace(/\D/g,'');
    const bcReal = window.XBX_DB.games.filter(g => g.platform==='xbox' && g.bc360 && g.bc360.compatible).length;
    ok('filtro retrocompat', bcShown === bcReal, bcShown + ' exibidos vs ' + bcReal + ' reais');
    $('#f-bc').value = 'all'; fire($('#f-bc'));
    // emulacao fica de fora: ela vem desligada de proposito e ligar dispara o
    // download do catalogo dela, o que mudaria todas as contagens seguintes
    $$('.f-plat').forEach(c => { c.checked = c.value !== 'emu'; fire(c); }); await wait(400);

    // busca
    $('#q').value = 'halo'; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(600);
    const hal = cards().map(c => c.querySelector('h3').textContent.toLowerCase());
    ok('busca funciona', hal.length > 3 && hal.every(t => t.includes('halo')), hal.length + ' resultados');

    // marcar "tenho"
    const first = cards()[0], fid = first.dataset.id;
    first.querySelector('.own-btn').click(); await wait(250);
    const stored = JSON.parse(localStorage.getItem('xbx.owned.v1') || '[]');
    ok('marcar tenho persiste', stored.includes(fid), 'id=' + fid);
    ok('card ganha classe own', $('.card[data-id="'+CSS.escape(fid)+'"]').classList.contains('own'));
    ok('contador de posse', $('#s-own').textContent.replace(/\D/g,'') === '1', $('#s-own').textContent);

    // filtro "so os que tenho"
    $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(500);
    $('#f-own').value = 'yes'; fire($('#f-own')); await wait(400);
    ok('filtro so-tenho', cards().length === 1, cards().length + ' card(s)');
    $('#f-own').value = 'no'; fire($('#f-own')); await wait(400);
    ok('filtro so-faltam', +$('#s-shown').textContent.replace(/\D/g,'') === window.XBX_DB.games.length - 1, $('#s-shown').textContent);
    $('#f-own').value = 'all'; fire($('#f-own')); await wait(300);

    // persistencia de filtros
    ok('filtros salvos no storage', !!localStorage.getItem('xbx.filters.v1'));

    // import: injeta ids conhecidos e valida via fluxo real do app
    const sample = window.XBX_DB.games.slice(0, 5).map(g => g.id);
    const wsample = window.XBX_DB.games.slice(10, 13).map(g => g.id);
    const payload = JSON.stringify({app:'xbox-vault', version:2,
      owned: sample.concat(['id-que-nao-existe']), wishlist: wsample});
    const file = new File([payload], 'col.json', {type:'application/json'});
    const dt = new DataTransfer(); dt.items.add(file);
    const inp = document.getElementById('file-in');
    inp.files = dt.files; fire(inp);
    await wait(600);
    const modalOpen = !document.getElementById('modal').hidden;
    ok('import abre dialogo', modalOpen, modalOpen ? 'ok' : 'modal nao abriu');
    if (modalOpen && document.getElementById('imp-merge')) {
      window.alert = () => {};
      document.getElementById('imp-merge').click(); await wait(500);
      const after = JSON.parse(localStorage.getItem('xbx.owned.v1') || '[]');
      ok('import soma ids validos', sample.every(i => after.includes(i)), after.length + ' na colecao');
      ok('import descarta id invalido', !after.includes('id-que-nao-existe'));
      const afterW = JSON.parse(localStorage.getItem('xbx.wishlist.v1') || '[]');
      ok('import traz a wishlist', wsample.every(i => afterW.includes(i)), afterW.length + ' na wishlist');
      ok('import mantem exclusividade', !after.some(i => afterW.includes(i)), 'nenhum id nas duas listas');
    } else ok('import soma ids validos', false, 'dialogo ausente');


    // ---- busca tolerante a erro de uma letra ----
    $('#q').value = 'usbsecpatch'; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await until(() => cards().length > 0, 6000); await wait(300);
    ok('busca tolerante acha UsbdSecPatch',
       cards().some(c => c.textContent.includes('UsbdSecPatch')),
       cards().length + ' resultado(s)');
    $('#q').value = 'xexmenu'; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await until(() => cards().length > 0, 6000); await wait(300);
    ok('busca exata continua funcionando', cards().some(c => c.textContent.includes('XeXMenu')));
    $('#q').value = 'zzzqqqxyw'; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await wait(600);
    ok('busca sem resultado continua vazia', cards().length === 0, cards().length + ' cards');
    $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);

    // ---- co-op vindo do Co-Optimus ----
    const comCoop = window.XBX_DB.games.filter(g => g.coopInfo);
    ok('catalogo tem co-op do Co-Optimus', comCoop.length > 0, comCoop.length + ' jogos');
    ok('todo coopInfo tem numero util',
       comCoop.every(g => ['local','online','combo','lan'].some(k => typeof g.coopInfo[k] === 'number')));
    ok('co-op do Co-Optimus liga a flag coop', comCoop.every(g => g.tags.coop === true));
    // o Co-Optimus so cataloga co-op: os numeros dele nunca podem baixar o total
    ok('total de jogadores nunca abaixo do co-op',
       comCoop.every(g => (g.tags.maxPlayers || 0) >= Math.max(g.tags.coopLocalMax || 0, g.tags.coopOnlineMax || 0)));
    ok('procedencia das outras tags preservada',
       comCoop.every(g => g.tags.coopSource === 'co-optimus' && g.tags.source !== 'co-optimus'));
    const comExp = comCoop.filter(g => g.coopInfo.exp);
    ok('descricao do co-op presente', comExp.length > 0, comExp.length + ' com texto');
    if (comExp.length) {
      const alvo = comExp[0];
      $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 0, 6000); await wait(300);
      const cc = cards().find(c => c.dataset.id === alvo.id);
      if (cc) {
        cc.querySelector('.thumb').click(); await wait(400);
        const mb = $('#modal-body');
        ok('modal mostra o bloco de co-op', mb.textContent.includes('Co-op em detalhe'));
        ok('modal mostra a descricao', !!mb.querySelector('.coop-exp'));
        ok('modal nao mostra mais a linha de fonte', !mb.textContent.includes('lido do arquivo de'));
        $('#modal-x').click(); await wait(200);
      } else ok('card do jogo com co-op', false, 'nao achei ' + alvo.id);
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- popup de detalhes ----
    const dcard = cards()[0], did = dcard.dataset.id;
    dcard.querySelector('.thumb').click();
    await until(() => document.querySelector('.sheet--det'));
    const sheet = document.querySelector('.sheet--det');
    ok('clique no card abre o popup', !!sheet && !document.getElementById('modal').hidden);
    if (sheet) {
      const dg = window.XBX_DB.games.find(g => g.id === did);
      ok('popup mostra o titulo', !!dg && sheet.textContent.includes(dg.title),
         dg ? dg.title : 'id do card nao esta no catalogo: ' + JSON.stringify(did));
      ok('popup tem secao de modos', sheet.textContent.includes('Modos de jogo'));
      ok('popup tem ficha', sheet.textContent.includes('Ficha'));
      if (dg && dg.description)
        ok('popup mostra a descricao inteira', sheet.textContent.includes(dg.description), 'len=' + dg.description.length);
      // marcar pelo popup reflete no card
      sheet.querySelector('[data-mark="own"]').click();
      await until(() => document.querySelector('.card[data-id="'+CSS.escape(did)+'"]')?.classList.contains('own'));
      ok('marcar pelo popup afeta o card',
         document.querySelector('.card[data-id="'+CSS.escape(did)+'"]')?.classList.contains('own'));
      ok('marcar pelo popup FECHA o popup', document.getElementById('modal').hidden);

      // desfaz pelo card (o popup ja fechou) e reabre para testar o Escape
      document.querySelector('.card[data-id="'+CSS.escape(did)+'"]').querySelector('.own-btn').click();
      await wait(300);
      document.querySelector('.card[data-id="'+CSS.escape(did)+'"]').querySelector('.thumb').click();
      await until(() => !document.getElementById('modal').hidden);
      document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
      await until(() => document.getElementById('modal').hidden);
      ok('Escape fecha o popup', document.getElementById('modal').hidden);
    }

    // ---- wishlist ----
    const wcard = cards()[1], wid = wcard.dataset.id;
    wcard.querySelector('.wish-btn').click(); await wait(250);
    ok('wishlist marca', JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]').includes(wid), 'id='+wid);
    ok('card ganha classe wish', wcard.classList.contains('wish'));
    const wlNow = JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]').length;
    ok('contador de wishlist bate com o storage',
       +$('#s-wish').textContent.replace(/\D/g,'') === wlNow, $('#s-wish').textContent + ' na tela, ' + wlNow + ' salvos');

    // exclusividade: marcar "tenho" num item da wishlist tira ele da wishlist
    wcard.querySelector('.own-btn').click(); await wait(250);
    const wl = JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]');
    const ol = JSON.parse(localStorage.getItem('xbx.owned.v1')||'[]');
    ok('tenho e quero sao exclusivos', !wl.includes(wid) && ol.includes(wid),
       'wishlist='+wl.length+' owned='+ol.length);
    // devolve para a wishlist para os testes de filtro/export
    wcard.querySelector('.wish-btn').click(); await wait(250);

    $('#f-own').value = 'wish'; fire($('#f-own')); await wait(400);
    const wlFilter = JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]').length;
    ok('filtro so-wishlist', cards().length === wlFilter, cards().length + ' cards vs ' + wlFilter + ' na wishlist');
    $('#f-own').value = 'all'; fire($('#f-own')); await wait(300);

    // ---- "nao quero" (esconder) ----
    $('#f-own').value = 'all'; fire($('#f-own')); await wait(400);
    $('#q').value = 'Bayonetta'; $('#q').dispatchEvent(new Event('input', {bubbles:true}));
    await until(() => cards().length > 0 && cards().length < 40, 6000); await wait(250);
    const hc = cards()[0], hid = hc.dataset.id;
    const antes = cards().length;
    hc.querySelector('.hide-btn').click(); await wait(400);
    ok('esconder tira o card da lista na hora', cards().length === antes - 1,
       antes + ' -> ' + cards().length);
    ok('contador de escondidos sobe', +$('#s-hide').textContent.replace(/\D/g,'') > 0, $('#s-hide').textContent);
    ok('estado gravado como hide',
       JSON.parse(localStorage.getItem('xbx.marks.v3')||'{}')[hid]?.s === 'hide');

    $('#f-own').value = 'hide'; fire($('#f-own')); await wait(500);
    ok('filtro "so os escondidos" mostra ele',
       cards().some(c => c.dataset.id === hid), cards().length + ' escondido(s)');
    ok('card escondido tem a classe', cards()[0].classList.contains('hide'));

    // desfazer devolve o jogo para a lista normal
    cards().find(c => c.dataset.id === hid).querySelector('.hide-btn').click(); await wait(400);
    $('#f-own').value = 'all'; fire($('#f-own')); await wait(500);
    ok('desfazer devolve o jogo', cards().some(c => c.dataset.id === hid));

    // esconder e exclusivo com tenho/wishlist
    const hc2 = cards().find(c => c.dataset.id === hid);
    hc2.querySelector('.own-btn').click(); await wait(350);
    const m1 = JSON.parse(localStorage.getItem('xbx.marks.v3')||'{}')[hid];
    ok('marcar tenho sai do escondido', m1.s === 'own', 'estado=' + m1.s);
    $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);

    // ---- merge por timestamp (o coracao da sincronizacao) ----
    // sem location.reload(): recarregar mata o contexto de avaliacao do teste
    window.alert = () => {};
    const lerMarks = () => JSON.parse(localStorage.getItem('xbx.marks.v3') || '{}');
    const buscar = async (txt) => {
      $('#q').value = txt; $('#q').dispatchEvent(new Event('input', {bubbles:true}));
      await until(() => cards().length > 0 && cards().length < 40, 6000);
      await wait(200);
      return cards()[0];
    };
    let c = await buscar('Bayonetta');
    const gid = c.dataset.id;
    // zera o estado desse card, seja qual for
    if (c.classList.contains('own')) { c.querySelector('.own-btn').click(); await wait(250); }
    if (c.classList.contains('wish')) { c.querySelector('.wish-btn').click(); await wait(250); }

    c = cards()[0];
    c.querySelector('.own-btn').click(); await wait(300);
    ok('marca grava timestamp', typeof lerMarks()[gid]?.t === 'number', 'id=' + gid);
    ok('marca grava estado', lerMarks()[gid]?.s === 'own');

    cards()[0].querySelector('.own-btn').click(); await wait(300);
    ok('desmarcar deixa lapide (s:null), nao some do arquivo',
       gid in lerMarks() && lerMarks()[gid].s === null, JSON.stringify(lerMarks()[gid]));

    cards()[0].querySelector('.own-btn').click(); await wait(300);
    const impMarks = async (obj) => {
      const f = new File([JSON.stringify(obj)], 'c.json', {type:'application/json'});
      const dt = new DataTransfer(); dt.items.add(f);
      const inp = document.getElementById('file-in'); inp.files = dt.files; fire(inp);
      // espera o dialogo REABRIR (nao so o botao existir: ele pode ser do dialogo anterior)
      await until(() => !document.getElementById('modal').hidden
                        && document.getElementById('imp-merge'), 6000);
      document.getElementById('imp-merge').click();
      await until(() => document.getElementById('modal').hidden, 6000);
      await wait(250);
    };

    await impMarks({app:'xbox-vault', version:3, owned:[], wishlist:[], marks:{[gid]:{s:null, t:1}}});
    ok('remocao ANTIGA e ignorada', lerMarks()[gid].s === 'own', 'estado=' + lerMarks()[gid].s);

    await impMarks({app:'xbox-vault', version:3, owned:[], wishlist:[],
                    marks:{[gid]:{s:null, t: Date.now() + 60000}}});
    ok('remocao MAIS NOVA vence', lerMarks()[gid].s === null, 'estado=' + lerMarks()[gid].s);

    await buscar('Bayonetta');
    ok('card reflete a remocao vinda de fora', !cards()[0].classList.contains('own'));

    const outro = window.XBX_DB.games[5].id;
    await impMarks({app:'xbox-vault', version:3, owned:[], wishlist:[],
                    marks:{[outro]:{s:'wish', t: Date.now() + 60000}}});
    ok('marca externa mais nova entra', lerMarks()[outro]?.s === 'wish');

    const v2alvo = window.XBX_DB.games[9].id;
    await impMarks({app:'xbox-vault', version:2, owned:[v2alvo], wishlist:[]});
    ok('arquivo v2 antigo (sem marks) ainda importa', lerMarks()[v2alvo]?.s === 'own');

    $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);

    // ---- nota do Metacritic ----
    $('#f-own').value='all'; fire($('#f-own'));
    $('#q').value=''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);
    const comMC = window.XBX_DB.games.filter(g => typeof g.mc === 'number');
    ok('catalogo tem notas', comMC.length > 2000, comMC.length + ' jogos com nota');
    ok('notas em faixa valida', comMC.every(g => g.mc >= 0 && g.mc <= 100));
    const halo = window.XBX_DB.games.find(g => g.id === 'x360-halo-3');
    ok('Halo 3 = 94', halo && halo.mc === 94, String(halo && halo.mc));

    $('#f-mc').value='90'; fire($('#f-mc')); await wait(600);
    const alta = window.XBX_DB.games.filter(g => g.mc >= 90).length;
    ok('filtro nota 90+', +$('#s-shown').textContent.replace(/\D/g,'') === alta, alta + ' jogos');
    ok('sem nota nao passa no filtro',
       cards().every(c => { const g = window.XBX_DB.games.find(x => x.id === c.dataset.id);
                            return g && g.mc >= 90; }));
    ok('card mostra o badge da nota', !!cards()[0].querySelector('.mc'),
       cards()[0].querySelector('.mc') ? cards()[0].querySelector('.mc').textContent : '');

    $('#f-sort').value='mc'; fire($('#f-sort')); await wait(600);
    const notas = cards().slice(0,10).map(c => {
      const g = window.XBX_DB.games.find(x => x.id === c.dataset.id); return g.mc; });
    ok('ordenacao por nota (desc)',
       notas.every((n,i) => i===0 || notas[i-1] >= n), JSON.stringify(notas));
    ok('ordenar por nota nao agrupa por ano', document.querySelectorAll('.year').length === 0,
       document.querySelectorAll('.year').length + ' cabecalhos de ano');
    ok('render progressivo tambem na lista corrida', cards().length >= 50, cards().length + ' cards');

    // popup mostra a nota
    cards()[0].querySelector('.thumb').click();
    await until(() => document.querySelector('.sheet--det'));
    ok('popup mostra a nota', !!document.querySelector('.det-mc'));
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await until(() => document.getElementById('modal').hidden);
    $('#f-mc').value='0'; fire($('#f-mc'));
    $('#f-sort').value='year-desc'; fire($('#f-sort')); await wait(500);

    // conteudo REAL do arquivo exportado (intercepta o blob do download)
    let captured = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = b => { captured = b; return origCreate.call(URL, b); };
    document.getElementById('btn-export').click(); await wait(400);
    URL.createObjectURL = origCreate;
    if (captured) {
      const txt = await captured.text(); const p = JSON.parse(txt);
      const cur = JSON.parse(localStorage.getItem('xbx.owned.v1') || '[]');
      ok('export gera JSON valido', p.app === 'xbox-vault' && Array.isArray(p.owned), 'v' + p.version);
      ok('export contem a colecao', p.owned.length === cur.length && p.owned.length > 0,
         p.owned.length + ' ids exportados');
      ok('export: count confere', p.count === p.owned.length, 'count=' + p.count);
      ok('export -> import ida e volta', p.owned.every(i => window.XBX_DB.games.some(g => g.id === i)),
         'todos os ids existem no catalogo');
      const curW = JSON.parse(localStorage.getItem('xbx.wishlist.v1') || '[]');
      ok('export inclui a wishlist', Array.isArray(p.wishlist) && p.wishlist.length === curW.length && curW.length > 0,
         (p.wishlist||[]).length + ' na wishlist exportada');
      ok('export v3', p.version === 3, 'version=' + p.version);
      ok('export inclui a lista de escondidos', Array.isArray(p.hidden), JSON.stringify(p.hidden||[]).slice(0,40));
      ok('export inclui marks com timestamp',
         !!p.marks && Object.values(p.marks).every(m => typeof m.t === 'number'),
         Object.keys(p.marks || {}).length + ' marcacoes');
    } else ok('export gera JSON valido', false, 'blob nao capturado');

    // filtros de tags (so valem quando ha dados de tags)
    const tagged = window.XBX_DB.games.filter(g => g.tags && Object.keys(g.tags).length);
    if (tagged.length > 100) {
      const coopBox = $$('.f-mode').find(c => c.value === 'coop');
      coopBox.checked = true; fire(coopBox); await wait(500);
      const shown = +$('#s-shown').textContent.replace(/\D/g,'');
      const real = window.XBX_DB.games.filter(g => g.tags && g.tags.coop).length;
      ok('filtro co-op', shown === real, shown + ' exibidos vs ' + real + ' reais');
      const lb = $$('.f-mode').find(c => c.value === 'multiplayerLocal');
      lb.checked = true; fire(lb); await wait(500);
      const both = window.XBX_DB.games.filter(g => g.tags && g.tags.coop && g.tags.multiplayerLocal).length;
      ok('filtros combinam (E logico)', +$('#s-shown').textContent.replace(/\D/g,'') === both, both + ' co-op local');
      coopBox.checked = false; fire(coopBox); lb.checked = false; fire(lb); await wait(400);

      $('#f-pl-min').value = '4'; fire($('#f-pl-min')); await wait(500);
      const p4 = window.XBX_DB.games.filter(g => { const t = g.tags||{};
        return Math.max(t.maxPlayersLocal||0, t.maxPlayersOnline||0, t.maxPlayers||0) >= 4; }).length;
      ok('filtro 4+ jogadores', +$('#s-shown').textContent.replace(/\D/g,'') === p4, p4 + ' jogos');
      $('#f-pl-min').value = '0'; fire($('#f-pl-min')); await wait(300);

      const withImg = window.XBX_DB.games.filter(g => g.image).length;
      ok('capas presentes', withImg > tagged.length * 0.5, withImg + ' jogos com imagem');
    } else ok('dados de tags presentes', false, 'apenas ' + tagged.length + ' jogos com tags');

    // scroll infinito
    const before = cards().length;
    window.scrollTo(0, document.body.scrollHeight); await wait(900);
    ok('render progressivo', cards().length > before, before + ' -> ' + cards().length + ' cards');

    localStorage.clear();
    return R.join('\n');
  })();
})()
