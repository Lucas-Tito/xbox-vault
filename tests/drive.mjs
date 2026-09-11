// Driver CDP minimo: abre a pagina no Chrome headless e avalia JS nela.
const PORT = 9224;
const target = process.argv[2];
async function j(u){ return (await fetch(u)).json(); }

const list = await j(`http://127.0.0.1:${PORT}/json/list`);
let page = list.find(t => t.type === 'page');
if (!page) { console.error('sem target'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
};
await new Promise(r => ws.onopen = r);
const send = (method, params={}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({id:i, method, params})); });

async function evalJS(expr){
  const r = await send('Runtime.evaluate', {expression: expr, awaitPromise:true, returnByValue:true});
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,500));
  return r.result?.result?.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', {url: target});
await new Promise(r => setTimeout(r, 4000));

const script = await (await import('node:fs/promises')).readFile(process.argv[3], 'utf8');
const out = await evalJS(script);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
ws.close();
