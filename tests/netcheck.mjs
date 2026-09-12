// Intercepta TODA requisicao que a pagina faz e agrupa por dominio.
const PORT=9227, target=process.argv[2], ligarEmu=process.argv[3]==='emu';
const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
let id=0; const pend=new Map(); const reqs=[];
ws.onmessage=e=>{
  const m=JSON.parse(e.data);
  if(m.method==='Network.requestWillBeSent') reqs.push(m.params.request.url);
  if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}
};
await new Promise(r=>ws.onopen=r);
const send=(me,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:me,params:p}));});
const js=e=>send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}).then(r=>r.result?.result?.value);
await send('Network.enable'); await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1400,height:2200,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:target});
await new Promise(r=>setTimeout(r,6000));
if(ligarEmu){
  await js(`(async()=>{const b=[...document.querySelectorAll('.f-plat')];
    b.forEach(c=>{c.checked=c.value==='emu';c.dispatchEvent(new Event('change',{bubbles:true}));});
    for(let i=0;i<100;i++){if(window.XBX_EMU)break;await new Promise(r=>setTimeout(r,300));}
    window.scrollTo(0,3000); await new Promise(r=>setTimeout(r,3000)); return 1;})()`);
}
// rola para forcar o lazy-load das imagens
await js(`(async()=>{for(let y=0;y<6000;y+=700){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,400));}return 1})()`);
await new Promise(r=>setTimeout(r,4000));
await js('try{localStorage.clear()}catch(e){}');
const base=new URL(target).origin;
const dom=new Map();
for(const u of reqs){
  let d; try{ d=new URL(u).origin; }catch{ d=u.slice(0,24); }
  dom.set(d,(dom.get(d)||0)+1);
}
console.log('  total de requisicoes: '+reqs.length);
for(const [d,n] of [...dom].sort((a,b)=>b[1]-a[1])){
  const externo = d!==base && !d.startsWith('data:') && !d.startsWith('blob:');
  console.log(`   ${externo?'EXTERNO ':'proprio '} ${String(n).padStart(5)}  ${d}`);
}
const ext=[...dom].filter(([d])=>d!==base&&!d.startsWith('data:')&&!d.startsWith('blob:'));
console.log(ext.length? '  >>> HA REQUISICOES EXTERNAS' : '  >>> NENHUMA requisicao externa');
ws.close();
