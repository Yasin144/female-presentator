// Isolated Electron integration QA: never opens/reloads the user's presenter.
const { app, BrowserWindow, protocol } = require('electron');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }]);
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'pdf-counting-automatic-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('disable-gpu');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const counting = source.slice(source.indexOf('const PDF_COUNTING_WORDS ='), source.indexOf('async function renderPdfPageAssets('));
const display = source.slice(source.indexOf('function getPdfCountingDisplayMode('), source.indexOf('function invalidatePdfPresentationRequest('));
const encoder = source.slice(source.indexOf('function buildPdfExactExportFramePlan('), source.indexOf('async function renderPdfTimelineForExport('));
const originalPdf = 'D:/LESSONS/NURSERY/NURSERY SEM 2/Nursery Course Book_Volume_2.pdf';
const server = http.createServer((request, response) => {
  if (request.url === '/qa.html') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><canvas id="canvas" width="1920" height="1080"></canvas>'); return; }
  const file = request.url === '/fixture.pdf' ? originalPdf : path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
  if ((file !== originalPdf && !file.startsWith(root + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'application/javascript');
  fs.createReadStream(file).pipe(response);
});
const timeout = setTimeout(() => { fs.writeFileSync(path.join(output, 'error.txt'), 'QA timeout'); app.exit(1); }, 180000);
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  protocol.handle('app', request => fetch(`http://127.0.0.1:${server.address().port}${new URL(request.url).pathname}`));
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  await window.loadURL('app://voice/qa.html');
  const report = await window.webContents.executeJavaScript(`(async () => {
    const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
    const normalizePdfLine=v=>String(v).replace(/\\s+/g,' ').trim();
    const state={pdf:{countingDisplayMode:'reveal',currentTimeMs:0,narration:{}},exportCapture:{}};
    ${display}
    ${counting}
    await ensurePdfCountingAutomationLoaded();
    if(pdfCountingPreparation.storageWarning) throw new Error(pdfCountingPreparation.storageWarning);
    const texts=['3 dogs','1 banana','20 stars'];
    const pages=texts.map((text,index)=>({index,pageNumber:index+1,text,...buildPdfCountingSetup(text,[],'unfamiliar-qa-document',index+1)}));
    if(pages.some(page=>page.countingPreparation.status!=='ready'||page.countingActivity.markersVerified||!shouldRevealPdfCountingObjects(page))) throw new Error('Unfamiliar document did not prepare safely');
    for(const page of pages) await ensurePdfCountingObjectsLoaded(page);
    const starts=pages.map((page,index)=>({pageIndex:index,countStarts:Array.from({length:page.countingActivity.count},(_,i)=>index*2400+300+i*90)}));
    state.pdf.narration.pdfTiming=starts;
    const savePng=name=>require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(output)},name),Buffer.from(canvas.toDataURL('image/png').split(',')[1],'base64'));
    const checkpoints=[];
    for(const [index,page] of pages.entries()) {
      for(const count of [0,1,page.countingActivity.count]) {
        state.pdf.currentTimeMs=count?starts[index].countStarts[count-1]+(count===1?0:220):index*2400;
        drawPdfCountingObjectScene(page,index);savePng('page-'+page.pageNumber+'-count-'+count+'.png');
        checkpoints.push({page:page.pageNumber,wanted:count,actual:getPdfCountingVisibleCount(page,index)});
      }
    }
    const review={id:'unfamiliar-qa-document:1',fingerprint:'unfamiliar-qa-document',pageNumber:1,mode:'original'};
    await pdfCountingPreparation.saveReview(review);
    const store=await import('/pdf-counting-local-store.js');
    const persisted=await store.readPdfCountingLocalState();
    if(persisted.reviews.length!==1||persisted.reviews[0].mode!=='original') throw new Error('Actual IndexedDB review did not persist');
    const preparationModule=await import('/pdf-counting-preparation.js');
    const reopened=await preparationModule.loadPdfCountingPreparation();
    if(reopened.prepare({text:'3 dogs',fingerprint:'unfamiliar-qa-document',pageNumber:1}).status!=='original') throw new Error('Saved decision not reused');
    const libraryDog=pdfCountingPreparation.getAsset('builtin:dogs');
    const dogBytes=await(await fetch('/'+libraryDog.src)).arrayBuffer();
    const custom={...libraryDog,id:'custom:retrievers',noun:'retrievers',aliases:['retrievers','retriever'],src:'data:image/png;base64,'+Buffer.from(dogBytes).toString('base64')};
    await pdfCountingPreparation.saveAsset(custom);
    const fresh=await preparationModule.loadPdfCountingPreparation();
    if(fresh.prepare({text:'2 retrievers',fingerprint:'another-qa-document',pageNumber:4}).status!=='ready') throw new Error('Saved custom asset was not reusable');
    const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const pdfTask=pdfjs.getDocument({url:'/fixture.pdf',isEvalSupported:false,enableXfa:false});
    const pdf=await pdfTask.promise;
    const realPdf=[];
    for(let pageNumber=26;pageNumber<=35;pageNumber++) {
      const page=await pdf.getPage(pageNumber),content=await page.getTextContent();
      const prepared=fresh.prepare({text:content.items.map(item=>item.str).join('\\n'),items:content.items,fingerprint:'new-copy-not-the-hardcoded-fingerprint',pageNumber});
      realPdf.push({page:pageNumber,status:prepared.status,count:prepared.count,noun:prepared.noun,reason:prepared.reason,evidence:prepared.analysis?.evidence});page.cleanup();
    }
    await pdfTask.destroy();
    const getPdfPresentationPages=()=>pages;
    const getPdfSelectionIndexForTime=ms=>Math.min(pages.length-1,Math.floor(ms/2400));
    const syncPdfPreviewPageFromTime=()=>{};
    const updatePlaybackProgressUi=()=>{},updateTaskProgressUi=()=>{};
    const getPdfExportBitrate=()=>4000000,getEffectiveExportQuality=()=>'hd';
    const ensurePdfPageRenderImageLoaded=()=>{throw new Error('Auto counting must not show all original objects');};
    const drawScene=()=>{const index=getPdfSelectionIndexForTime(state.pdf.currentTimeMs);drawPdfCountingObjectScene(pages[index],index);};
    ${encoder}
    const encoded=await encodePdfExactTimelineForExport({durationMs:7200,playbackRate:1,frameRate:30});
    require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(output)},'automatic-counting.ivf'),Buffer.from(await encoded.blob.arrayBuffer()));
    return {origin:location.origin,checkpoints,persistence:true,customPictureReuse:true,realPdf,export:{frames:encoded.frameCount,durationMs:encoded.durationMs}};
  })()`);
  if(report.checkpoints.some(point=>point.wanted!==point.actual)) throw new Error('Counting checkpoint mismatch');
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2));
  window.destroy();server.close();clearTimeout(timeout);app.quit();
}).catch(error=>{fs.writeFileSync(path.join(output,'error.txt'),String(error.stack||error));server.close();clearTimeout(timeout);app.exit(1);});
