(async () => {
  // Simula a visita anterior com TODAS as categorias sob demanda ligadas: e o
  // caso de quem ja usava o site antes de XBLIG e homebrew sairem do db.js.
  localStorage.setItem('xbx.filters.v1', JSON.stringify({
    plats: ['x360', 'xbox', 'xblig', 'homebrew', 'emu'], relType: 'oficial'
  }));
  location.reload();
  return 'recarregando';
})()
