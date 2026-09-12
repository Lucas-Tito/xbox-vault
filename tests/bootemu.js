(async () => {
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn,ms=30000)=>{for(let t=0;t<ms;t+=200){if(fn())return true;await wait(200);}return false;};
  // simula a visita anterior com a emulacao ligada
  localStorage.setItem('xbx.filters.v1', JSON.stringify({plats:['emu'],relType:'oficial'}));
  location.reload();
  return 'recarregando';
})()
