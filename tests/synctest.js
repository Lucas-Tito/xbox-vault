(async () => {
 try {
  const R = [], ok = (n,c,d='') => R.push((c?'PASS':'FALL')+' | '+n+(d?' | '+d:''));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms=8000) => { for(let t=0;t<ms;t+=100){ if(fn()) return true; await wait(100);} return false; };
  const $ = s => document.querySelector(s);
  await wait(2500);

  ok('API existe neste navegador', typeof window.showSaveFilePicker === 'function');
  ok('XBXSync exposto', !!window.XBXSync);
  ok('XBXSync.suporta', window.XBXSync && window.XBXSync.suporta === true);

  // o handle falso ja foi injetado antes da pagina carregar (pre_fsapi.js)
  const F = window.__fakeFile;
  const leArq = () => { try { return JSON.parse(F.conteudo); } catch (e) { return null; } };

  // conecta pelo caminho real do botao
  document.getElementById('btn-sync').click();
  const conectou = await until(() => F.conteudo.length > 0);
  ok('conectar grava o arquivo inicial', conectou, F.conteudo.length + ' bytes');
  ok('botao mostra estado conectado',
     document.getElementById('btn-sync').dataset.estado === 'on',
     document.getElementById('btn-sync').dataset.estado);

  // ---- marcar um jogo deve gravar no arquivo ----
  $('#q').value = 'Bayonetta'; $('#q').dispatchEvent(new Event('input',{bubbles:true}));
  await until(() => document.querySelectorAll('.card').length > 0 && document.querySelectorAll('.card').length < 40);
  await wait(300);
  const card = document.querySelectorAll('.card')[0], gid = card.dataset.id;
  if (card.classList.contains('own')) { card.querySelector('.own-btn').click(); await wait(400); }
  document.querySelectorAll('.card')[0].querySelector('.own-btn').click();
  const gravou = await until(() => leArq()?.marks?.[gid]?.s === 'own');
  ok('marcar grava no arquivo automaticamente', gravou, gid);

  // ---- outro dispositivo escreve no arquivo; puxar() deve trazer ----
  const outro = window.XBX_DB.games[7].id;
  const atual = leArq() || {marks:{}};
  atual.marks[outro] = { s: 'wish', t: Date.now() + 120000 };
  F.conteudo = JSON.stringify(atual);
  await window.XBXSync.puxar();
  await wait(400);
  const veio = JSON.parse(localStorage.getItem('xbx.marks.v3')||'{}')[outro];
  ok('puxa mudanca feita por outro dispositivo', veio && veio.s === 'wish', JSON.stringify(veio));

  // ---- gravacao nao pode apagar o que o outro dispositivo escreveu ----
  const terceiro = window.XBX_DB.games[11].id;
  const c2 = leArq() || {marks:{}};
  c2.marks[terceiro] = { s: 'own', t: Date.now() + 120000 };
  F.conteudo = JSON.stringify(c2);
  // agora faz uma mudanca local, que dispara gravacao
  document.querySelectorAll('.card')[0].querySelector('.own-btn').click();
  await wait(2500);
  const final = (leArq() || {}).marks || {};
  ok('gravar NAO apaga o que veio de fora', final[terceiro] && final[terceiro].s === 'own',
     'terceiro=' + JSON.stringify(final[terceiro]));

  // ---- desconectar ----
  await window.XBXSync.desconectar();
  await wait(300);
  ok('desconectar volta ao estado off', document.getElementById('btn-sync').dataset.estado === 'off');
  localStorage.clear();
  return R.join('\n');
 } catch (e) { return 'ERRO NO TESTE: ' + (e && e.message) + '\n' + (typeof R !== 'undefined' ? R.join('\n') : ''); }
})()
