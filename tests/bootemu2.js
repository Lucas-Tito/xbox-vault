(async () => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=40000)=>{for(let t=0;t<ms;t+=200){if(fn())return true;await wait(200);}return false;};
  const R=[], ok=(n,c,d='')=>R.push((c?'PASS':'FALL')+' | '+n+(d?' | '+d:''));

  // O filtro salvo pede as tres categorias, e nada no boot dispara o download
  // sozinho: sem o pendentes() do boot, a lista viria vazia para quem ja usava.
  const todos = await until(()=>window.XBX_XBLIG && window.XBX_HB && window.XBX_EMU);
  ok('as tres categorias carregam sozinhas no boot', todos,
     'xblig=' + !!window.XBX_XBLIG + ' hb=' + !!window.XBX_HB + ' emu=' + !!window.XBX_EMU);

  const temCards = await until(()=>document.querySelectorAll('.card').length>0);
  ok('lista NAO fica vazia', temCards, document.querySelectorAll('.card').length+' cards');

  // e os cinco filtros continuam marcados depois do carregamento
  const marcados = [...document.querySelectorAll('.f-plat')].filter(c=>c.checked).map(c=>c.value);
  ok('os cinco filtros seguem marcados', marcados.length === 5, marcados.join(','));

  // o painel soma o catalogo inteiro, agora todo carregado
  const total = +document.querySelector('#s-total').textContent.replace(/\D/g,'');
  const soma = window.XBX_DB.games.length + window.XBX_XBLIG.games.length +
               window.XBX_HB.games.length + window.XBX_EMU.games.length;
  ok('o total bate com a soma dos quatro bundles', total === soma, total + ' vs ' + soma);

  localStorage.clear();
  return R.join('\n');
})()
