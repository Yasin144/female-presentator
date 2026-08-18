const targets = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const target = targets.find(item => item.type === 'page');
if (!target) throw new Error('Electron renderer target was not found.');
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
const events = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve } = pending.get(message.id);
    pending.delete(message.id);
    resolve(message);
    return;
  }
  if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) events.push(message);
});
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const send = (method, params = {}) => new Promise(resolve => {
  const id = nextId++;
  pending.set(id, { resolve });
  socket.send(JSON.stringify({ id, method, params }));
});
await send('Runtime.enable');
await send('Log.enable');
const getButtonPoint = async label => {
  const result = await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === ${JSON.stringify(label)}); if (!button) return null; const r = button.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`, returnByValue: true });
  return result.result?.result?.value;
};
const clickPoint = async point => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
};
const presentatorPoint = await getButtonPoint('Presentator');
if (presentatorPoint) {
  await clickPoint(presentatorPoint);
  await new Promise(resolve => setTimeout(resolve, 300));
}
const exporterPoint = await getButtonPoint('My Exporter');
if (!exporterPoint) throw new Error('My Exporter button was not found.');
const hitBefore = await send('Runtime.evaluate', { expression: `(() => { const p=${JSON.stringify(exporterPoint)}; const e=document.elementFromPoint(p.x,p.y); const ancestry=[]; for(let n=e;n&&ancestry.length<6;n=n.parentElement){ const s=getComputedStyle(n); ancestry.push({tag:n.tagName,id:n.id,className:n.className,text:n===e?n.textContent?.trim().slice(0,80):'',position:s.position,zIndex:s.zIndex,pointerEvents:s.pointerEvents,rect:(()=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()}); } return { point:p, ancestry }; })()`, returnByValue: true });
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...exporterPoint });
await new Promise(resolve => setTimeout(resolve, 250));
const hover = await send('Runtime.evaluate', { expression: `(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'My Exporter'); const style = getComputedStyle(button); return { hovered: button.matches(':hover'), background: style.backgroundImage || style.backgroundColor, color: style.color }; })()`, returnByValue: true });
await clickPoint(exporterPoint);
await new Promise(resolve => setTimeout(resolve, 1200));
const state = await send('Runtime.evaluate', { expression: `(() => ({ exporterPages: document.querySelectorAll('.mx-page').length, hasTimeline: document.body.innerText.includes('MASTER') && document.body.innerText.includes('Razor Cut'), htmlLength: document.documentElement.outerHTML.length }))()`, returnByValue: true });
const translatePoint = await getButtonPoint('Translate Audio');
if (translatePoint) {
  await clickPoint(translatePoint);
  await new Promise(resolve => setTimeout(resolve, 350));
}
const translateOpen = await send('Runtime.evaluate', { expression: `({ open: document.body.classList.contains('tdub-open'), hidden: document.querySelector('#translateDubModule')?.hidden })`, returnByValue: true });
await clickPoint(exporterPoint);
await new Promise(resolve => setTimeout(resolve, 800));
const returned = await send('Runtime.evaluate', { expression: `({ exporterPages: document.querySelectorAll('.mx-page').length, translateOpen: document.body.classList.contains('tdub-open'), translateHidden: document.querySelector('#translateDubModule')?.hidden })`, returnByValue: true });
console.log(JSON.stringify({ hitBefore: hitBefore.result?.result?.value, hover: hover.result?.result?.value, firstOpen: state.result?.result?.value, translateOpen: translateOpen.result?.result?.value, returned: returned.result?.result?.value, exceptions: events.filter(item => item.method === 'Runtime.exceptionThrown') }, null, 2));
socket.close();
