(() => {
  const R = [];
  const ok = (n, c, d='') => R.push((c?'PASS':'FALL') + ' | ' + n + (d?' | '+d:''));
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const cards = () => $$('.card');
  // O catalogo virou varios bundles: o db.js traz 360 e Xbox original, e XBLIG,
  // homebrew e emulacao descem quando a categoria e ligada. Quase todo teste
  // quer o que o site conhece AGORA, que e a uniao do que ja baixou.
  const catalogo = () => [].concat(
    (window.XBX_DB && window.XBX_DB.games) || [],
    (window.XBX_XBLIG && window.XBX_XBLIG.games) || [],
    (window.XBX_HB && window.XBX_HB.games) || [],
    (window.XBX_EMU && window.XBX_EMU.games) || []);
  // Ja o total do painel conta o catalogo INTEIRO, inclusive o que nao baixou:
  // o tamanho de cada categoria viaja em counts, no bundle principal.
  const totalTudo = () => {
    const c = (window.XBX_DB && window.XBX_DB.counts) || {};
    let t = catalogo().length;
    if (!window.XBX_XBLIG) t += c.xblig || 0;
    if (!window.XBX_HB) t += c.homebrew || 0;
    if (!window.XBX_EMU) t += c.emu || 0;
    return t;
  };
  const fire = (el, t='change') => el.dispatchEvent(new Event(t, {bubbles:true}));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // espera condicional: evita flake quando a rede esta lenta (CDN frio apos deploy)
  const until = async (fn, ms = 6000, step = 100) => {
    for (let t = 0; t < ms; t += step) { if (fn()) return true; await wait(step); }
    return false;
  };
  // O card nao tem mais botao de "tenho": marcar e desmarcar so pelo popup,
  // entao o teste percorre o mesmo caminho que o usuario percorre.
  // O popup agora e em abas: chegar num dado quer dizer abrir a aba dele.
  const irPara = async (nome) => {
    const b = [...document.querySelectorAll('#modal-body .aba')]
      .find(x => x.textContent.trim() === nome);
    if (b) { b.click(); await wait(150); }
    return !!b;
  };
  const toggleOwn = async (card) => {
    card.querySelector('.thumb').click();
    await until(() => !document.getElementById('modal').hidden);
    document.querySelector('#modal-body [data-mark="own"]').click();
    await until(() => document.getElementById('modal').hidden);
    await wait(250);
  };

  return (async () => {
    // estado de visita anterior nao pode vazar entre execucoes do teste
    ok('catalogo carregou', catalogo().length > 3000, catalogo().length + ' jogos');
    ok('stats total confere',
       +$('#s-total').textContent.replace(/\D/g,'') === totalTudo(),
       $('#s-total').textContent + ' na tela, ' + totalTudo() + ' somando os bundles');
    // ---- catalogos sob demanda ----
    ok('db.js nao traz XBLIG nem homebrew',
       !window.XBX_DB.games.some(g => g.platform === 'xblig' || g.platform === 'homebrew'),
       window.XBX_DB.games.length + ' jogos no bundle principal');
    ok('nenhum catalogo sob demanda desceu sozinho',
       !window.XBX_XBLIG && !window.XBX_HB && !window.XBX_EMU);
    // o total de cada um viaja em counts, senao o filtro exibiria zero
    ok('o filtro mostra o tamanho da categoria antes de baixar',
       $('[data-cnt="plat-xblig"]').textContent === String(window.XBX_DB.counts.xblig) &&
       $('[data-cnt="plat-homebrew"]').textContent === String(window.XBX_DB.counts.homebrew) &&
       $('[data-cnt="plat-emu"]').textContent === String(window.XBX_DB.counts.emu),
       'xblig=' + $('[data-cnt="plat-xblig"]').textContent +
       ' hb=' + $('[data-cnt="plat-homebrew"]').textContent +
       ' emu=' + $('[data-cnt="plat-emu"]').textContent);

    // clicar no card abre a ficha; sair do site so pelos links da Ficha tecnica
    ok('o titulo do card nao e link',
       cards().every(c => !c.querySelector('h3 a')),
       cards().length + ' cards conferidos');

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
    const bcReal = catalogo().filter(g => g.platform==='xbox' && g.bc360 && g.bc360.compatible).length;
    ok('filtro retrocompat', bcShown === bcReal, bcShown + ' exibidos vs ' + bcReal + ' reais');
    $('#f-bc').value = 'all'; fire($('#f-bc'));
    // emulacao fica de fora: ela vem desligada de proposito e ligar dispara o
    // download do catalogo dela, o que mudaria todas as contagens seguintes
    $$('.f-plat').forEach(c => { c.checked = c.value !== 'emu'; fire(c); });
    await until(() => window.XBX_XBLIG && window.XBX_HB, 20000); await wait(500);
    ok('ligar a categoria baixa o bundle dela',
       !!window.XBX_XBLIG && !!window.XBX_HB,
       'xblig=' + (((window.XBX_XBLIG||{}).games)||[]).length +
       ' hb=' + (((window.XBX_HB||{}).games)||[]).length);

    // busca
    $('#q').value = 'halo'; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(600);
    const hal = cards().map(c => c.querySelector('h3').textContent.toLowerCase());
    ok('busca funciona', hal.length > 3 && hal.every(t => t.includes('halo')), hal.length + ' resultados');

    // marcar "tenho"
    const first = cards()[0], fid = first.dataset.id;
    await toggleOwn(first);
    const stored = JSON.parse(localStorage.getItem('xbx.owned.v1') || '[]');
    ok('marcar tenho persiste', stored.includes(fid), 'id=' + fid);
    ok('card ganha classe own', $('.card[data-id="'+CSS.escape(fid)+'"]').classList.contains('own'));
    // sem o botao no card, o selo e o unico sinal que nao depende de matiz
    ok('card marcado ganha o selo de visto',
       getComputedStyle($('.card[data-id="'+CSS.escape(fid)+'"]'), '::after')
         .content.includes('\u2713'));
    ok('contador de posse', $('#s-own').textContent.replace(/\D/g,'') === '1', $('#s-own').textContent);

    // filtro "so os que tenho"
    $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true})); await wait(500);
    $('#f-own').value = 'yes'; fire($('#f-own')); await wait(400);
    ok('filtro so-tenho', cards().length === 1, cards().length + ' card(s)');
    $('#f-own').value = 'no'; fire($('#f-own')); await wait(400);
    ok('filtro so-faltam', +$('#s-shown').textContent.replace(/\D/g,'') === catalogo().length - 1, $('#s-shown').textContent);
    $('#f-own').value = 'all'; fire($('#f-own')); await wait(300);

    // persistencia de filtros
    ok('filtros salvos no storage', !!localStorage.getItem('xbx.filters.v1'));

    // import: injeta ids conhecidos e valida via fluxo real do app
    const sample = catalogo().slice(0, 5).map(g => g.id);
    const wsample = catalogo().slice(10, 13).map(g => g.id);
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
    const comCoop = catalogo().filter(g => g.coopInfo);
    ok('catalogo tem co-op do Co-Optimus', comCoop.length > 0, comCoop.length + ' jogos');
    ok('todo coopInfo tem numero util',
       comCoop.every(g => ['local','online','combo','lan'].some(k => typeof g.coopInfo[k] === 'number')));
    ok('co-op do Co-Optimus liga a flag coop', comCoop.every(g => g.tags.coop === true));
    // o Co-Optimus so cataloga co-op: os numeros dele nunca podem baixar o total
    ok('total de jogadores nunca abaixo do co-op',
       comCoop.every(g => (g.tags.maxPlayers || 0) >= Math.max(g.tags.coopLocalMax || 0, g.tags.coopOnlineMax || 0)));
    ok('procedencia das outras tags preservada',
       comCoop.every(g => g.tags.coopSource === 'co-optimus' && g.tags.source !== 'co-optimus'));
    // o inverso: quem tem co-op sem conferencia precisa dizer isso
    // o aviso vale nos dois lados: quem diz ter co-op sem conferencia, e quem
    // diz nao ter -- calar no segundo caso faz parecer que a ausencia foi checada
    const semCoopNemInfo = catalogo().filter(g =>
      !g.tags.coop && !g.coopInfo && g.tags.source !== 'not-a-game' && g.tags.singlePlayer);
    ok('existem jogos sem co-op e sem conferencia', semCoopNemInfo.length > 0,
       semCoopNemInfo.length + ' jogos');
    {
      const sn = semCoopNemInfo[0];
      $('#q').value = sn.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 0, 6000); await wait(300);
      const cn = cards().find(c => c.dataset.id === sn.id);
      if (cn) {
        cn.querySelector('.thumb').click(); await wait(400);
        // a caixa aparece mesmo vazia: calar faria o leitor concluir que a
        // ausencia de co-op foi conferida, e ela nao foi
        const vazia = $('#modal-body .coop-caixa');
        ok('avisa que a ausencia de co-op nao foi conferida',
           !!vazia && /não consta no Co-Optimus/.test(vazia.textContent), sn.title);
        ok('e a caixa vazia nao inventa numero',
           !!vazia && !vazia.querySelector('.num'));
        $('#modal-x').click(); await wait(200);
      }
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }
    const semConf = catalogo().filter(g => g.tags.coop && !g.coopInfo);
    ok('existem jogos com co-op nao conferido', semConf.length > 0, semConf.length + ' jogos');
    if (semConf.length) {
      const sc = semConf[0];
      $('#q').value = sc.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 0, 6000); await wait(300);
      const cx = cards().find(c => c.dataset.id === sc.id);
      if (cx) {
        cx.querySelector('.thumb').click(); await wait(400);
        // aqui o catalogo AFIRMA co-op e o Co-Optimus nao tem o jogo: a caixa
        // vazia e o que impede o leitor de achar que alguem conferiu
        const cxv = $('#modal-body .coop-caixa');
        ok('modal avisa que o co-op nao foi conferido',
           !!cxv && /não consta no Co-Optimus/.test(cxv.textContent));
        ok('e a caixa vazia nao traz numero nem extra',
           !!cxv && !cxv.querySelector('.num') && !cxv.querySelector('.chip-coop'));
        $('#modal-x').click(); await wait(200);
      } else ok('card do jogo sem conferencia', false, 'nao achei ' + sc.id);
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

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
        // o bloco virou caixa propria, com a fonte no topo e a data do snapshot
        const cx = mb.querySelector('.coop-caixa');
        ok('modal nomeia a fonte do co-op',
           !!cx && /Co-Optimus/.test(cx.querySelector('.coop-topo').textContent));
        ok('a caixa diz de quando e a copia lida',
           !!cx && /lido em \d{2}\/\d{2}\/\d{4}/.test(cx.querySelector('.coop-topo').textContent),
           cx ? cx.querySelector('.coop-topo').textContent.trim() : '');
        // os quatro numeros sao a mesma medida: em grade da para comparar
        const nums = cx ? [...cx.querySelectorAll('.num')] : [];
        ok('os numeros de co-op saem em grade', nums.length >= 2,
           nums.map(n => n.textContent.trim()).join(' | '));
        ok('e o rotulo e System Link, nao LAN',
           !/\bLAN\b/.test(cx ? cx.textContent : ''), '');
        ok('modal mostra a descricao', !!mb.querySelector('.coop-exp'));
        ok('modal nao mostra mais a linha de fonte', !mb.textContent.includes('lido do arquivo de'));
        $('#modal-x').click(); await wait(200);
      } else ok('card do jogo com co-op', false, 'nao achei ' + alvo.id);
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- screenshots do Marketplace e Title Updates ----
    const comShot = catalogo().filter(g => g.screens);
    ok('catalogo tem galeria de screenshots', comShot.length > 1000, comShot.length + ' jogos');
    const comTu = catalogo().filter(g => g.tu && g.tu.n);
    ok('catalogo tem Title Updates', comTu.length > 0, comTu.length + ' com patch');
    {
      const alvo = comShot.find(g => g.tu && g.tu.n) || comShot[0];
      $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 0, 6000); await wait(300);
      const cc = cards().find(c => c.dataset.id === alvo.id);
      if (cc) {
        ok('card nao carrega screenshot', !cc.querySelector('.shots'));
        cc.querySelector('.thumb').click(); await wait(500);
        const mb = $('#modal-body');
        const sh = mb.querySelector('.shots');
        ok('popup monta a galeria', !!sh);
        ok('galeria tem o numero certo de imagens',
           sh && sh.querySelectorAll('img').length === alvo.screens);
        if (alvo.tu && alvo.tu.n)
          ok('popup mostra quantos TUs o jogo teve',
             new RegExp(alvo.tu.n + ' TUs? conhecidos?').test(mb.textContent),
             alvo.tu.n + ' patches');

        // visualizador: a miniatura amplia por cima da ficha, sem abrir outra aba
        if (sh) {
          const links = [...sh.querySelectorAll('a')];
          links[0].click(); await wait(300);
          ok('miniatura abre o visualizador', !$('#lb').hidden);
          const prim = $('#lb-img').getAttribute('src');
          ok('visualizador mostra a imagem clicada',
             prim === links[0].getAttribute('href'), $('#lb-n').textContent);
          ok('a ficha continua aberta atras', !$('#modal').hidden);
          if (links.length > 1) {
            $('#lb-next').click(); await wait(200);
            ok('a seta avanca', $('#lb-img').getAttribute('src') !== prim, $('#lb-n').textContent);
            document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
            await wait(200);
            ok('a seta do teclado volta', $('#lb-img').getAttribute('src') === prim, $('#lb-n').textContent);
          }
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          await wait(250);
          ok('Esc fecha o visualizador e devolve a ficha',
             $('#lb').hidden && !$('#modal').hidden);
        }
        $('#modal-x').click(); await wait(200);
      } else ok('card do jogo com galeria', false, 'nao achei ' + alvo.id);
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- tempo de jogo (curadoria manual) ----
    {
      const comTempo = catalogo().filter(g => g.tempo);
      ok('catalogo tem tempo de jogo', comTempo.length > 0, comTempo.length + ' jogos');
      const alvo = comTempo[0];
      if (alvo) {
        $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const cc = cards().find(c => c.dataset.id === alvo.id);
        if (cc) {
          cc.querySelector('.thumb').click(); await wait(400);
          const mb = $('#modal-body');
          ok('popup mostra o tempo de jogo', mb.textContent.includes('Tempo de jogo'));
          // nem todo jogo tem as tres: o HowLongToBeat so traz a medida que
          // teve relato. Conferir exatamente as que o registro declara.
          const rot = {main: 'História principal', plus: 'Principal + extras',
                       cem: 'Completar 100%'};
          ok('mostra exatamente as medidas que tem',
             Object.keys(rot).every(k => (typeof alvo.tempo[k] === 'number') ===
               mb.querySelector('.tempo').textContent.includes(rot[k])),
             Object.keys(rot).filter(k => typeof alvo.tempo[k] === 'number').join('+'));
          ok('formata em horas', /\d+h/.test(mb.querySelector('.tempo').textContent),
             mb.querySelector('.tempo').textContent.trim().slice(0, 40));
          if (alvo.tempo.fonte === 'aproximado')
            ok('avisa que o valor e aproximado', mb.textContent.includes('aproximado'));
          $('#modal-x').click(); await wait(200);
        }
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- lista de Title Updates ----
    {
      const alvo = catalogo().filter(g => g.tu && g.tu.n > 1)
        .sort((a, b) => b.tu.n - a.tu.n)[0];
      if (alvo) {
        $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const cc = cards().find(c => c.dataset.id === alvo.id);
        if (cc) {
          cc.querySelector('.thumb').click(); await wait(400);
          ok('a aba de conteudo adicional existe quando ha patch',
             await irPara('Conteúdo adicional'));
          // a aba tem dois details.tu quando o jogo tem DLC: pegar o dos patches
          const det = [...$$('#modal-body details.tu')]
            .find(d => /TUs? conhecidos?/.test(d.querySelector('summary').textContent));
          const ul = det && det.querySelector('ul');
          ok('lista de Title Updates no popup', !!det, alvo.title + ' (' + alvo.tu.n + ')');
          // getBoundingClientRect do <ul> mente: o layout reporta altura mesmo
          // com o conteudo pulado por content-visibility. Medir o <details>.
          ok('comeca recolhida', det && !det.open && !ul.checkVisibility());
          const fechado = Math.round(det.getBoundingClientRect().height);
          det.open = true; await wait(150);
          ok('abre e mostra a lista',
             ul.checkVisibility() && det.getBoundingClientRect().height > fechado,
             fechado + 'px -> ' + Math.round(det.getBoundingClientRect().height) + 'px');
          const lis = det.querySelectorAll('li');
          ok('um item por patch', lis.length === alvo.tu.n, lis.length + ' itens');
          ok('cada item traz versao, data e tamanho',
             [...lis].every(li => /TU\d/.test(li.textContent) && /\d{4}/.test(li.textContent)
                            && /(KB|MB)/.test(li.textContent)), lis[0].textContent.trim());
          // e para saber o que existiu, nao para baixar
          ok('sem link de download', det.querySelectorAll('a').length === 0);
          ok('sem hash exposto', !/[0-9A-F]{20}/.test(det.textContent));
          $('#modal-x').click(); await wait(200);
        }
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- tamanho do download ----
    {
      const comTam = catalogo().filter(g => typeof g.tamanho === 'number');
      ok('catalogo tem tamanho de download', comTam.length > 1000, comTam.length + ' jogos');
      ok('tamanho em GB, sempre positivo e plausivel',
         comTam.every(g => g.tamanho > 0 && g.tamanho < 60));
      // a regra que a #1 pediu: abaixo de 1 GB o numero sai em MB, e nao em
      // "0,04 GB", que e o que a mediana do catalogo viraria
      const casos = [[comTam.find(g => g.tamanho < 1), 'MB'],
                     [comTam.find(g => g.tamanho > 1), 'GB']];
      for (const [g, unidade] of casos) {
        if (!g) { ok('achar jogo para o caso ' + unidade, false); continue; }
        $('#q').value = g.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === g.id);
        if (!c) { ok('card de ' + g.title + ' na tela', false); continue; }
        c.querySelector('.thumb').click(); await wait(400);
        // o tamanho virou pilula na faixa de fatos, nao e mais linha de ficha
        const lin = $$('#modal-body .chip')
          .find(c => c.querySelector('span') && c.querySelector('span').textContent === 'Tamanho Total');
        ok('popup mostra o tamanho', !!lin, g.title + ' = ' + g.tamanho + ' GB');
        const txt = lin ? lin.querySelector('b').textContent : '';
        ok('unidade certa para ' + g.tamanho + ' GB', txt.endsWith(unidade), txt);
        if (unidade === 'MB') {
          ok('MB bate com o GB guardado',
             +txt.replace(/\D/g, '') === Math.round(g.tamanho * 1024), txt);
        }
        $('#modal-x').click(); await wait(200);
      }
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- card nao afirma modo que ninguem apurou ----
    {
      const presumidos = catalogo().filter(g => (g.tags||{}).source === 'xblig-default');
      ok('catalogo tem jogos com modo presumido', presumidos.length > 1000,
         presumidos.length + ' jogos');
      const g = presumidos.find(x => x.image);
      if (g) {
        ok('o dado ainda diz single player', !!(g.tags||{}).singlePlayer);
        $('#q').value = g.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === g.id);
        if (c) {
          const etiquetas = [...c.querySelectorAll('.tag')].map(t => t.textContent.trim());
          // o modo foi inventado pelo coletor: o card cala, e a ficha explica
          ok('o card NAO mostra etiqueta de modo', !etiquetas.includes('1P'),
             etiquetas.join(' '));
          ok('mas o card segue mostrando a plataforma', etiquetas.includes('INDIE'),
             etiquetas.join(' '));
        } else ok('card do jogo presumido', false, g.id);
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- procedencia das tags de modo ----
    // O popup dizia "Confianca high: conferido a mao", e "manual" nao e
    // conferencia: sao numeros digitados de memoria numa tabela do coletor, sem
    // fonte registrada. O grau virou procedencia, e so o palpite ganha alerta.
    {
      const porFonte = (f) => catalogo().find(g => (g.tags||{}).source === f && g.image);
      const casos = [
        ['manual', /^Modos de jogo sem fonte registrada\.$/, true],
        ['genre-prior', /deduzidos do gênero/, true],
        ['wikipedia-infobox', /^Modos de jogo derivados da ficha do artigo/, false]
      ];
      for (const [fonte, esperado, alerta] of casos) {
        const g = porFonte(fonte);
        if (!g) { ok('achar jogo com fonte ' + fonte, false); continue; }
        $('#q').value = g.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === g.id);
        if (!c) { ok('card de ' + g.title, false); continue; }
        c.querySelector('.thumb').click(); await wait(400);
        await irPara('Modos/co-op');
        const pane = $('#modal-body .pane:not([hidden])');
        const n = pane && pane.querySelector('.nota');
        ok('fonte ' + fonte + ' se apresenta pelo que e', !!n && esperado.test(n.textContent),
           n ? n.textContent.trim() : 'sem nota');
        ok('fonte ' + fonte + (alerta ? ' em alerta' : ' sem alerta'),
           !!n && n.classList.contains('alerta') === alerta);
        // a regua ambar corre ao lado da LISTA, nao so do texto
        const caixa = pane && pane.querySelector('.fonte-fraca');
        ok('fonte ' + fonte + (alerta ? ' com regua na lista' : ' sem regua'),
           !!caixa === alerta && (!alerta || !!caixa.querySelector('ul.modos')));
        // e o aviso do Co-Optimus fica FORA dela: fala de outra coisa
        if (alerta) {
          const coop = [...pane.querySelectorAll('.nota')]
            .find(x => /Co-Optimus/.test(x.textContent));
          ok('o aviso do Co-Optimus fica fora da regua',
             !coop || !caixa.contains(coop));
        }
        $('#modal-x').click(); await wait(200);
      }
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- DLC do Marketplace ----
    {
      const comDlc = catalogo().filter(g => (g.dlc || []).length);
      ok('catalogo tem lista de DLC', comDlc.length > 100, comDlc.length + ' jogos');
      const alvo = comDlc.filter(g => g.image).sort((a,b) => b.dlc.length - a.dlc.length)[0];
      if (alvo) {
        $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === alvo.id);
        if (c) {
          c.querySelector('.thumb').click(); await wait(400);
          ok('aba de conteudo adicional existe quando ha DLC',
             await irPara('Conteúdo adicional'));
          const det = [...$$('#modal-body details.tu')]
            .find(d => /DLCs? conhecidos?/.test(d.querySelector('summary').textContent));
          ok('popup lista os DLCs', !!det,
             det ? det.querySelector('summary').textContent.trim() : 'sem details de DLC');
          if (det) {
            det.open = true; await wait(150);
            // guarda contra o defeito que existiu: item renderizado como objeto
            const textos = [...det.querySelectorAll('li')].map(x => x.textContent);
            ok('nenhum item sai como objeto cru',
               textos.every(t => !/\[object/.test(t)), textos[0] || '');
            const comTam = alvo.dlc.filter(d => d && d.mb);
            ok('todo DLC com tamanho mostra o tamanho',
               det.querySelectorAll('.tu-mb').length === comTam.length,
               det.querySelectorAll('.tu-mb').length + ' de ' + comTam.length);
            ok('um item por DLC', det.querySelectorAll('li').length === alvo.dlc.length,
               det.querySelectorAll('li').length + ' de ' + alvo.dlc.length);
            // e para saber o que existiu: a loja fechou em 2024
            ok('sem link e sem preco no DLC',
               !det.querySelector('a') && !/R\$|US\$|\d+[.,]\d\d\b/.test(det.textContent));
          }
          $('#modal-x').click(); await wait(200);
        } else ok('card do jogo com DLC', false, alvo.id);
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- nota geral do Metacritic ----
    // A frase antiga dizia "não é da versão de X", falso em 55 dos 198 casos, e
    // num jogo de emulação saía "não é da versão de Emulação". O rótulo agora
    // nomeia o que o dado é, e a lista de consoles vive no hover.
    {
      const gerais = catalogo().filter(g => g.mcGeral);
      ok('catalogo tem nota geral do Metacritic', gerais.length > 50, gerais.length + ' jogos');
      ok('e a lista de consoles veio no bundle',
         gerais.every(g => typeof g.mcPlats === 'string' && g.mcPlats.length > 2));
      const g = gerais.find(x => x.image);
      if (g) {
        $('#q').value = g.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === g.id);
        if (c) {
          c.querySelector('.thumb').click(); await wait(400);
          const bloco = $('#modal-body .det-mc');
          ok('o rotulo diz que a nota e geral',
             !!bloco && /Nota Geral do Metacritic/.test(bloco.textContent),
             bloco ? bloco.textContent.trim() : 'sem bloco');
          ok('a lista de consoles fica no hover',
             !!bloco && (bloco.getAttribute('title') || '').includes(g.mcPlats),
             bloco ? bloco.getAttribute('title') : '');
          // nada de asterisco nem rodape: o rotulo carrega a ressalva
          ok('sumiu o asterisco e o rodape',
             !$('#modal-body .det-aviso') && !/não é da versão de/.test($('#modal-body').textContent));
          $('#modal-x').click(); await wait(200);
        } else ok('card do jogo com nota geral', false, g.id);
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- resolução nativa ----
    {
      const comRes = catalogo().filter(g => g.resolucao);
      ok('catalogo tem resolucao nativa', comRes.length > 100, comRes.length + ' jogos');
      // o interessante e justamente quem NAO roda em 720p
      const sub = comRes.find(g => g.resolucao.h < 720 && g.image) || comRes[0];
      $('#q').value = sub.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 0, 6000); await wait(300);
      const c = cards().find(x => x.dataset.id === sub.id);
      if (c) {
        c.querySelector('.thumb').click(); await wait(400);
        await irPara('Ficha técnica');
        const lin = $$('#modal-body .li')
          .find(l => l.querySelector('span') && l.querySelector('span').textContent === 'Resolução');
        ok('ficha mostra a resolucao', !!lin,
           lin ? lin.querySelector('b').textContent : 'sem linha');
        ok('resolucao bate com o dado',
           !!lin && lin.querySelector('b').textContent.indexOf(sub.resolucao.w + ' x ' + sub.resolucao.h) === 0,
           sub.title + ' = ' + sub.resolucao.w + 'x' + sub.resolucao.h);
        // a fonte e uma thread de forum, entao ela precisa estar dita em algum lugar
        ok('a fonte vive no hover', !!lin && /Beyond3D/.test(lin.getAttribute('title') || ''));
        $('#modal-x').click(); await wait(200);
      } else ok('card do jogo com resolucao', false, sub.id);
      $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
      await until(() => cards().length > 50, 8000); await wait(300);
    }

    // ---- jogos multidisco ----
    {
      const multi = catalogo().filter(g => g.discos > 1);
      ok('catalogo tem jogos multidisco', multi.length > 10, multi.length + ' jogos');
      const g = multi.find(x => x.image);
      if (g) {
        $('#q').value = g.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === g.id);
        if (c) {
          c.querySelector('.thumb').click(); await wait(400);
          const pil = $$('#modal-body .chip')
            .find(x => x.querySelector('span') && x.querySelector('span').textContent === 'Discos');
          ok('a visao geral mostra quantos discos', !!pil && pil.textContent.includes(g.discos),
             pil ? pil.textContent.trim() : 'sem pilula');
          // "Tamanho Total" fecha a leitura de multiplicar um pelo outro
          const tam = $$('#modal-body .chip')
            .find(x => x.querySelector('span') && x.querySelector('span').textContent === 'Tamanho Total');
          ok('e o tamanho ao lado dele diz Total', !g.tamanho || !!tam,
             tam ? tam.textContent.trim() : 'jogo sem tamanho');
          $('#modal-x').click(); await wait(200);
        } else ok('card do jogo multidisco', false, g.id);
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- Title ID ----
    {
      const alvo = catalogo().find(g => g.titleId && g.image);
      ok('catalogo tem Title ID',
         catalogo().filter(g => g.titleId).length > 1000,
         catalogo().filter(g => g.titleId).length + ' jogos');
      if (alvo) {
        $('#q').value = alvo.title; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 0, 6000); await wait(300);
        const c = cards().find(x => x.dataset.id === alvo.id);
        if (c) {
          c.querySelector('.thumb').click(); await wait(400);
          await irPara('Ficha técnica');
          const cod = $('#modal-body .li code');
          // e o que se copia para o Xbox Unity, o Xenia e os gerenciadores de TU
          ok('ficha mostra o Title ID', !!cod && cod.textContent === alvo.titleId,
             cod ? cod.textContent : 'sem <code>');
          ok('Title ID em fonte monoespacada',
             !!cod && /mono|Menlo|Consolas/i.test(getComputedStyle(cod).fontFamily));
          $('#modal-x').click(); await wait(200);
        } else ok('card do jogo com Title ID', false, alvo.id);
        $('#q').value = ''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
        await until(() => cards().length > 50, 8000); await wait(300);
      }
    }

    // ---- popup de detalhes ----
    const dcard = cards()[0], did = dcard.dataset.id;
    dcard.querySelector('.thumb').click();
    await until(() => document.querySelector('.sheet--det'));
    const sheet = document.querySelector('.sheet--det');
    ok('clique no card abre o popup', !!sheet && !document.getElementById('modal').hidden);
    if (sheet) {
      const dg = catalogo().find(g => g.id === did);
      ok('popup mostra o titulo', !!dg && sheet.textContent.includes(dg.title),
         dg ? dg.title : 'id do card nao esta no catalogo: ' + JSON.stringify(did));
      const abas = [...sheet.querySelectorAll('.aba')].map(b => b.textContent.trim());
      ok('popup vem em abas', abas.length >= 2, abas.join(' | '));
      ok('a primeira aba ja vem aberta',
         sheet.querySelector('.aba[aria-selected="true"]') === sheet.querySelector('.aba'));
      ok('so um painel visivel de cada vez',
         [...sheet.querySelectorAll('.pane')].filter(p => !p.hidden).length === 1);
      const segunda = sheet.querySelectorAll('.aba')[1];
      segunda.click(); await wait(200);
      ok('clicar na aba troca o painel',
         segunda.getAttribute('aria-selected') === 'true' &&
         !sheet.querySelector('.pane[data-pane="1"]').hidden &&
         sheet.querySelector('.pane[data-pane="0"]').hidden);
      ok('a palavra Extras sumiu do popup', !/\bExtras\b/.test(sheet.textContent));
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
      await toggleOwn(document.querySelector('.card[data-id="'+CSS.escape(did)+'"]'));
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
    await toggleOwn(wcard);
    const wl = JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]');
    const ol = JSON.parse(localStorage.getItem('xbx.owned.v1')||'[]');
    ok('tenho e quero sao exclusivos', !wl.includes(wid) && ol.includes(wid),
       'wishlist='+wl.length+' owned='+ol.length);
    // devolve para a wishlist para os testes de filtro/export
    wcard.querySelector('.wish-btn').click(); await wait(250);

    $('#f-own').value = 'wish'; fire($('#f-own')); await wait(400);
    const wlFilter = JSON.parse(localStorage.getItem('xbx.wishlist.v1')||'[]').length;
    ok('filtro so-wishlist', cards().length === wlFilter, cards().length + ' cards vs ' + wlFilter + ' na wishlist');

    // "so os que eu ainda nao marquei": nem tenho, nem quero, nem escondi.
    // Nao compara com o tamanho do catalogo (depende de quais bundles ja
    // desceram): compara com "so os que faltam", que so difere pela wishlist.
    $('#f-own').value = 'none'; fire($('#f-own')); await wait(400);
    const semMarca = +$('#s-shown').textContent.replace(/\D/g,'');
    ok('nao-marcados nao trazem marcado nenhum',
       !cards().some(c => c.classList.contains('own') || c.classList.contains('wish') ||
                          c.classList.contains('hide')),
       semMarca + ' exibidos');
    $('#f-own').value = 'no'; fire($('#f-own')); await wait(400);
    const faltam = +$('#s-shown').textContent.replace(/\D/g,'');
    ok('nao-marcados = faltam menos a wishlist', faltam - semMarca === wlFilter,
       faltam + ' - ' + semMarca + ' = ' + (faltam - semMarca) + ', wishlist ' + wlFilter);

    // marcar pelo popup enquanto o filtro esta ligado tira o card da tela
    $('#f-own').value = 'none'; fire($('#f-own')); await wait(400);
    const nm = cards()[0], nmid = nm.dataset.id, nmAntes = cards().length;
    await toggleOwn(nm);
    ok('marcar tira o card dos nao-marcados',
       cards().length === nmAntes - 1 && !cards().some(c => c.dataset.id === nmid),
       nmAntes + ' -> ' + cards().length);
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
    await toggleOwn(hc2);
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
    if (c.classList.contains('own')) { await toggleOwn(c); }
    if (c.classList.contains('wish')) { c.querySelector('.wish-btn').click(); await wait(250); }

    c = cards()[0];
    await toggleOwn(c);
    ok('marca grava timestamp', typeof lerMarks()[gid]?.t === 'number', 'id=' + gid);
    ok('marca grava estado', lerMarks()[gid]?.s === 'own');

    await toggleOwn(cards()[0]);
    ok('desmarcar deixa lapide (s:null), nao some do arquivo',
       gid in lerMarks() && lerMarks()[gid].s === null, JSON.stringify(lerMarks()[gid]));

    await toggleOwn(cards()[0]);
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

    const outro = catalogo()[5].id;
    await impMarks({app:'xbox-vault', version:3, owned:[], wishlist:[],
                    marks:{[outro]:{s:'wish', t: Date.now() + 60000}}});
    ok('marca externa mais nova entra', lerMarks()[outro]?.s === 'wish');

    const v2alvo = catalogo()[9].id;
    await impMarks({app:'xbox-vault', version:2, owned:[v2alvo], wishlist:[]});
    ok('arquivo v2 antigo (sem marks) ainda importa', lerMarks()[v2alvo]?.s === 'own');

    $('#q').value = ''; $('#q').dispatchEvent(new Event('input', {bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);

    // ---- nota do Metacritic ----
    $('#f-own').value='all'; fire($('#f-own'));
    $('#q').value=''; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
    await until(() => cards().length > 50, 8000); await wait(300);
    const comMC = catalogo().filter(g => typeof g.mc === 'number');
    ok('catalogo tem notas', comMC.length > 2000, comMC.length + ' jogos com nota');
    ok('notas em faixa valida', comMC.every(g => g.mc >= 0 && g.mc <= 100));
    const halo = catalogo().find(g => g.id === 'x360-halo-3');
    ok('Halo 3 = 94', halo && halo.mc === 94, String(halo && halo.mc));

    $('#f-mc').value='90'; fire($('#f-mc')); await wait(600);
    const alta = catalogo().filter(g => g.mc >= 90).length;
    ok('filtro nota 90+', +$('#s-shown').textContent.replace(/\D/g,'') === alta, alta + ' jogos');
    ok('sem nota nao passa no filtro',
       cards().every(c => { const g = catalogo().find(x => x.id === c.dataset.id);
                            return g && g.mc >= 90; }));
    ok('card mostra o badge da nota', !!cards()[0].querySelector('.mc'),
       cards()[0].querySelector('.mc') ? cards()[0].querySelector('.mc').textContent : '');

    $('#f-sort').value='mc'; fire($('#f-sort')); await wait(600);
    const notas = cards().slice(0,10).map(c => {
      const g = catalogo().find(x => x.id === c.dataset.id); return g.mc; });
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
      ok('export -> import ida e volta', p.owned.every(i => catalogo().some(g => g.id === i)),
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
    const tagged = catalogo().filter(g => g.tags && Object.keys(g.tags).length);
    if (tagged.length > 100) {
      const coopBox = $$('.f-mode').find(c => c.value === 'coop');
      coopBox.checked = true; fire(coopBox); await wait(500);
      const shown = +$('#s-shown').textContent.replace(/\D/g,'');
      const real = catalogo().filter(g => g.tags && g.tags.coop).length;
      ok('filtro co-op', shown === real, shown + ' exibidos vs ' + real + ' reais');
      const lb = $$('.f-mode').find(c => c.value === 'multiplayerLocal');
      lb.checked = true; fire(lb); await wait(500);
      const both = catalogo().filter(g => g.tags && g.tags.coop && g.tags.multiplayerLocal).length;
      ok('filtros combinam (E logico)', +$('#s-shown').textContent.replace(/\D/g,'') === both, both + ' co-op local');
      coopBox.checked = false; fire(coopBox); lb.checked = false; fire(lb); await wait(400);

      $('#f-pl-min').value = '4'; fire($('#f-pl-min')); await wait(500);
      const p4 = catalogo().filter(g => { const t = g.tags||{};
        return Math.max(t.maxPlayersLocal||0, t.maxPlayersOnline||0, t.maxPlayers||0) >= 4; }).length;
      ok('filtro 4+ jogadores', +$('#s-shown').textContent.replace(/\D/g,'') === p4, p4 + ' jogos');
      $('#f-pl-min').value = '0'; fire($('#f-pl-min')); await wait(300);

      const withImg = catalogo().filter(g => g.image).length;
      ok('capas presentes', withImg > tagged.length * 0.5, withImg + ' jogos com imagem');
    } else ok('dados de tags presentes', false, 'apenas ' + tagged.length + ' jogos com tags');

    // scroll infinito
    const before = cards().length;
    window.scrollTo(0, document.body.scrollHeight); await wait(900);
    ok('render progressivo', cards().length > before, before + ' -> ' + cards().length + ' cards');

    // ---- regressao: importar marcacao de categoria nao carregada ----
    // O applyImport comparava contra o catalogo CARREGADO, entao um backup com
    // jogos de emulacao perdia essas marcacoes em silencio, e o aviso contava
    // menos do que perdia. Agora ele baixa o catalogo antes de julgar.
    {
      const emuId = 'emu-ps1-resident-evil';
      ok('o id de emulacao nao esta no bundle principal',
         !window.XBX_DB.games.some(g => g.id === emuId));
      ok('e a emulacao nao foi carregada ate aqui', !window.XBX_EMU);
      await impMarks({app:'xbox-vault', version:3, owned:[], wishlist:[],
                      marks:{[emuId]:{s:'hide', t: Date.now()}}});
      await until(() => !!window.XBX_EMU, 20000); await wait(400);
      const m = JSON.parse(localStorage.getItem('xbx.marks.v3') || '{}');
      ok('a marcacao de emulacao sobrevive ao import',
         !!m[emuId] && m[emuId].s === 'hide', JSON.stringify(m[emuId]));
      ok('o import baixou o catalogo que faltava', !!window.XBX_EMU);
    }

    localStorage.clear();
    return R.join('\n');
  })();
})()
