/* Gaveta de filtros no celular.
 *
 * Precisa de janela ESTREITA (ate 820px), senao a media query nem entra e o
 * teste passa sem testar nada -- por isso a primeira assercao confere a largura.
 * A janela padrao do headless ja da 780x493 e entra na media query, mas o
 * --window-size=500,760 aproxima de um celular de verdade, onde o cabecalho
 * quebra em mais linhas.
 *
 * O bug que este arquivo defende: a coluna era ancorada em 57px, a altura do
 * cabecalho no desktop. Na tela estreita o cabecalho quebra em varias linhas e
 * chega a 261px, entao os primeiros 204px da coluna nasciam atras dele, com
 * z-index menor, e o grupo Colecao inteiro ficava invisivel. Quem abria os
 * filtros no celular nao via o comeco deles e nao tinha como saber que bastava
 * rolar para cima.
 *
 * uso: google-chrome --headless=new --window-size=500,760 --remote-debugging-port=9227 \
 *        --user-data-dir=/tmp/xbxtest about:blank &
 *      node tests/drive.mjs "file://$PWD/index.html" tests/mobile.js
 */

(() => {
  const $ = s => document.querySelector(s);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const R = [];
  const ok = (n, c, d='') => R.push((c?'PASS':'FALL') + ' | ' + n + (d?' | '+d:''));
  return (async () => {
    R.push('viewport ' + innerWidth + 'x' + innerHeight);
    ok('janela estreita o bastante para a media query', innerWidth <= 820,
       innerWidth + 'px: rode o Chrome com --window-size=500,760');
    ok('gaveta comeca fechada', !$('#side').classList.contains('open'));
    $('#btn-filters').click(); await wait(400);
    const r = $('#side').getBoundingClientRect();
    ok('cobre a tela inteira', Math.round(r.top) === 0 && Math.round(r.height) === innerHeight
       && Math.round(r.width) === innerWidth, JSON.stringify({top:r.top,h:r.height,w:r.width}));
    const g1 = $('#side .fgroup'), p = g1.getBoundingClientRect();
    ok('1o grupo (' + g1.querySelector('h4').textContent + ') visivel', p.top >= 0 && p.bottom <= innerHeight,
       'top=' + Math.round(p.top) + ' bottom=' + Math.round(p.bottom));
    const alvo = document.elementFromPoint(Math.round(p.left + 20), Math.round(p.top + 10));
    ok('nada por cima dele', !!(alvo && alvo.closest('#side')), alvo && alvo.tagName);
    ok('cabecalho da gaveta aparece', $('.side-top').getBoundingClientRect().height > 0);
    ok('rodape aparece', $('.side-bot').getBoundingClientRect().height > 0);
    ok('fundo nao rola', document.body.classList.contains('filtros-abertos'));
    ok('contador do rodape = exibidos', $('#side-n').textContent === $('#s-shown').textContent,
       $('#side-n').textContent + ' vs ' + $('#s-shown').textContent);
    // filtrar com a gaveta aberta atualiza o numero ao vivo
    const antes = $('#side-n').textContent;
    $('#f-own').value = 'yes'; $('#f-own').dispatchEvent(new Event('change', {bubbles:true}));
    await wait(400);
    ok('numero acompanha o filtro ao vivo', $('#side-n').textContent !== antes,
       antes + ' -> ' + $('#side-n').textContent);
    $('#f-own').value = 'all'; $('#f-own').dispatchEvent(new Event('change', {bubbles:true}));
    await wait(300);
    // o rodape rola junto? nao: ele e fixo, e o miolo que rola
    const bot = $('.side-bot').getBoundingClientRect();
    $('.side-scroll').scrollTop = $('.side-scroll').scrollHeight; await wait(200);
    ok('rodape fica no lugar ao rolar', Math.round($('.side-bot').getBoundingClientRect().top) === Math.round(bot.top));
    ok('botao Limpar filtros alcancavel', $('#btn-reset').getBoundingClientRect().bottom <= innerHeight);
    $('#side-x').click(); await wait(400);
    ok('X fecha', !$('#side').classList.contains('open') && !document.body.classList.contains('filtros-abertos'));
    $('#btn-filters').click(); await wait(400);
    $('#side-done').click(); await wait(400);
    ok('"Ver N jogos" fecha', !$('#side').classList.contains('open'));
    $('#btn-filters').click(); await wait(400);
    document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    await wait(300);
    ok('Esc fecha', !$('#side').classList.contains('open'));
    return R;
  })();
})();
