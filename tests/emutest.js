(async () => { try {
  const R=[], ok=(n,c,d='')=>R.push((c?'PASS':'FALL')+' | '+n+(d?' | '+d:''));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=25000)=>{for(let t=0;t<ms;t+=150){if(fn())return true;await wait(150);}return false;};
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const cards=()=>$$('.card');
  const fire=el=>el.dispatchEvent(new Event('change',{bubbles:true}));
  await until(()=>cards().length>10); await wait(500);

  ok('emulacao NAO vem carregada', !window.XBX_EMU, 'db-emu nao foi baixado');
  const emuBox = $$('.f-plat').find(c=>c.value==='emu');
  ok('checkbox de emulacao existe', !!emuBox);
  ok('emulacao vem DESLIGADA', emuBox && !emuBox.checked);
  ok('subfiltros escondidos', $('#g-emu').hidden);
  const base = window.XBX_DB.games.length;
  ok('catalogo base sem emulacao', base === 6900, base + ' jogos');

  // liga -> deve baixar sob demanda
  emuBox.checked = true; fire(emuBox);
  const veio = await until(()=>!!window.XBX_EMU, 40000);
  ok('ligar dispara o carregamento', veio, veio ? window.XBX_EMU.games.length+' jogos de emulacao' : 'nao carregou');
  await until(()=>cards().length>0); await wait(600);
  ok('subfiltros aparecem', !$('#g-emu').hidden);

  // por padrao so oficiais
  ok('filtro de tipo comeca em oficiais', $('#f-reltype').value === 'oficial');
  const exib = +$('#s-shown').textContent.replace(/\D/g,'');
  const oficiais = window.XBX_EMU.games.filter(g=>g.releaseType==='Released').length;
  ok('so oficiais por padrao', exib === 6900 + oficiais, exib + ' = 6900 + ' + oficiais);

  $('#f-reltype').value='all'; fire($('#f-reltype')); await wait(700);
  ok('"tudo" inclui ROM hacks',
     +$('#s-shown').textContent.replace(/\D/g,'') === 6900 + window.XBX_EMU.games.length);

  // sub-filtro por sistema
  $('#f-reltype').value='oficial'; fire($('#f-reltype'));
  $$('.f-plat').forEach(c=>{c.checked = c.value==='emu'; fire(c);}); await wait(800);
  const sn = $$('.f-sys').find(c=>c.value==='SNES');
  sn.checked=true; fire(sn); await wait(800);
  const so = window.XBX_EMU.games.filter(g=>g.system==='SNES'&&g.releaseType==='Released').length;
  ok('filtro por sistema (SNES)', +$('#s-shown').textContent.replace(/\D/g,'') === so, so + ' SNES oficiais');
  ok('cards mostram o sistema', cards()[0].textContent.includes('SNES'));

  // tags vindas de campo estruturado
  const comMax = window.XBX_EMU.games.filter(g=>g.tags&&g.tags.maxPlayers>=2).length;
  ok('tags de jogadores presentes', comMax > 2000, comMax + ' com 2+ jogadores');
  localStorage.clear();
  return R.join('\n');
} catch(e){ return 'ERRO: '+(e&&e.message)+'\n'+(e&&e.stack||'').slice(0,300); } })()
