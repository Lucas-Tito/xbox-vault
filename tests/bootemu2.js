(async () => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=40000)=>{for(let t=0;t<ms;t+=200){if(fn())return true;await wait(200);}return false;};
  const R=[], ok=(n,c,d='')=>R.push((c?'PASS':'FALL')+' | '+n+(d?' | '+d:''));
  const carregou = await until(()=>!!window.XBX_EMU);
  ok('emulacao carrega sozinha no boot', carregou);
  const temCards = await until(()=>document.querySelectorAll('.card').length>0);
  ok('lista NAO fica vazia', temCards, document.querySelectorAll('.card').length+' cards');
  localStorage.clear();
  return R.join('\n');
})()
