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
  ok('catalogo base sem emulacao', base > 6000 && !window.XBX_EMU, base + ' jogos');
  // zero seria mentira: a categoria tem milhares de jogos, eles e que nao foram
  // baixados ainda. Enquanto o db.js nao trouxer o total, o certo e nao dizer nada.
  const cntEmu = () => $('[data-cnt="plat-emu"]').textContent.trim();
  const totalEmu = (window.XBX_DB.counts || {}).emu;
  ok('contador da emulacao nao mostra zero', cntEmu() !== '0', 'mostra "' + cntEmu() + '"');
  ok('desligada, o contador usa o total do bundle ou fica vazio',
     totalEmu ? cntEmu() === String(totalEmu) : cntEmu() === '',
     totalEmu ? 'db.js diz ' + totalEmu : 'db.js ainda nao grava o total');

  // liga -> deve baixar sob demanda
  emuBox.checked = true; fire(emuBox);
  const veio = await until(()=>!!window.XBX_EMU, 40000);
  ok('ligar dispara o carregamento', veio, veio ? window.XBX_EMU.games.length+' jogos de emulacao' : 'nao carregou');
  await until(()=>cards().length>0); await wait(600);
  ok('subfiltros aparecem', !$('#g-emu').hidden);
  ok('carregada, o contador mostra o catalogo inteiro',
     cntEmu() === String(window.XBX_EMU.games.length), 'contador=' + cntEmu());

  // por padrao so oficiais + os cancelados que vazaram jogaveis
  ok('filtro de tipo comeca em oficiais', $('#f-reltype').value === 'oficial');
  const exib = +$('#s-shown').textContent.replace(/\D/g,'');
  const normal = g=>g.releaseType==='Released'||g.releaseType==='Vazado';
  const oficiais = window.XBX_EMU.games.filter(normal).length;
  ok('oficiais + vazados por padrao', exib === base + oficiais, exib + ' = ' + base + ' + ' + oficiais);

  // cancelados sem build jogavel foram removidos do catalogo
  const naoLancados = window.XBX_EMU.games.filter(g=>g.releaseType==='Unreleased').length;
  ok('nenhum cancelado injogavel sobrou', naoLancados === 0, naoLancados + ' Unreleased');
  const vaz = window.XBX_EMU.games.filter(g=>g.releaseType==='Vazado');
  ok('vazados jogaveis presentes', vaz.length === 4, vaz.map(g=>g.title).join(', '));
  ok('todo vazado explica o motivo', vaz.every(g=>g.nota && g.fonte));
  ok('vazados aparecem no filtro padrao',
     vaz.every(g=>window.XBX_EMU.games.filter(normal).indexOf(g) >= 0));
  const ge = window.XBX_DB.games.find(g=>g.id==='x360-goldeneye-007-xbla');
  ok('GoldenEye do XBLA no catalogo principal', !!ge && ge.releaseType === 'Vazado',
     ge ? ge.title + ' ' + ge.year : 'ausente');

  // opcao dedicada: mostra os 4 da emulacao + o do 360
  $('#f-reltype').value='vaz'; fire($('#f-reltype')); await wait(700);
  ok('filtro "so vazados" mostra so eles',
     +$('#s-shown').textContent.replace(/\D/g,'') === vaz.length + 1,
     $('#s-shown').textContent);
  ok('card de vazado tem etiqueta', cards().some(c=>c.textContent.includes('VAZADO')));
  $('#f-reltype').value='oficial'; fire($('#f-reltype')); await wait(700);

  $('#f-reltype').value='all'; fire($('#f-reltype')); await wait(700);
  ok('"tudo" inclui ROM hacks',
     +$('#s-shown').textContent.replace(/\D/g,'') === base + window.XBX_EMU.games.length);

  // sub-filtro por sistema
  $('#f-reltype').value='oficial'; fire($('#f-reltype'));
  $$('.f-plat').forEach(c=>{c.checked = c.value==='emu'; fire(c);}); await wait(800);
  const sn = $$('.f-sys').find(c=>c.value==='SNES');
  sn.checked=true; fire(sn); await wait(800);
  const so = window.XBX_EMU.games.filter(g=>g.system==='SNES'&&normal(g)).length;
  ok('filtro por sistema (SNES)', +$('#s-shown').textContent.replace(/\D/g,'') === so, so + ' SNES oficiais');
  ok('cards mostram o sistema', cards()[0].textContent.includes('SNES'));

  // tags vindas de campo estruturado
  const comMax = window.XBX_EMU.games.filter(g=>g.tags&&g.tags.maxPlayers>=2).length;
  ok('tags de jogadores presentes', comMax > 2000, comMax + ' com 2+ jogadores');
  localStorage.clear();
  return R.join('\n');
} catch(e){ return 'ERRO: '+(e&&e.message)+'\n'+(e&&e.stack||'').slice(0,300); } })()
