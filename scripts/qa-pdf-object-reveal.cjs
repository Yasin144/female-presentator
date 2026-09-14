// Isolated, hidden Electron QA. Never connects to or reloads the user's app.
// Run: electron scripts/qa-pdf-object-reveal.cjs [--preview-only]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'tmp', 'pdf-object-reveal', 'realistic-v2-qa');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(output, 'profile-')));
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-background-timer-throttling');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const counting = source.slice(source.indexOf('const PDF_COUNTING_WORDS ='), source.indexOf('async function renderPdfPageAssets('));
const encoder = source.slice(source.indexOf('function buildPdfExactExportFramePlan('), source.indexOf('async function renderPdfTimelineForExport('));
const display = source.slice(source.indexOf('function getPdfCountingDisplayMode('), source.indexOf('function invalidatePdfPresentationRequest('));
const previewOnly = process.argv.includes('--preview-only');
const singlePage = Number(process.argv.find(argument => argument.startsWith('--page='))?.split('=')[1]) || 0;
const server = http.createServer((request, response) => {
  if (request.url === '/qa.html') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><canvas id="canvas" width="1920" height="1080"></canvas></body></html>');
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(request.url.split('?')[0]));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404); response.end(); return;
  }
  response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : 'application/javascript');
  fs.createReadStream(file).pipe(response);
});
const timeout = setTimeout(() => { fs.writeFileSync(path.join(output, 'error.txt'), 'QA timeout'); app.exit(1); }, 180000);
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/qa.html`);
  const report = await window.webContents.executeJavaScript(`(async () => {
    const canvas = document.getElementById('canvas'), ctx = canvas.getContext('2d');
    const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
    const normalizePdfLine = value => String(value).replace(/\\s+/g,' ').trim();
    const state = {pdf:{countingDisplayMode:'reveal',currentTimeMs:0,narration:{}},exportCapture:{}};
    ${display}
    ${counting}
    const pages=Object.entries(PDF_COUNTING_LAYOUTS).filter(([number])=>!${singlePage}||Number(number)===${singlePage}).map(([number,layout])=>({
      index:Number(number)-1,pageNumber:Number(number),
      countingActivity:getPdfCountingActivity(PDF_COUNTING_WORDS[layout.points.length]+' '+layout.noun,{fingerprint:PDF_COUNTING_DOCUMENT_ID,pageNumber:Number(number)})
    }));
    const pageDuration=2400;
    state.pdf.narration.pdfTiming=pages.map((page,index)=>({pageIndex:page.index,
      countStarts:Array.from({length:page.countingActivity.count},(_,i)=>index*pageDuration+300+i*90)}));
    const manifestUrl='/assets/pdf-counting/'+PDF_COUNTING_DOCUMENT_ID+'/manifest-realistic-v2.json';
    if (${previewOnly}) {
      // Visual mask review only: never claims an unverified profile is approved.
      const manifest=await (await fetch(manifestUrl)).json();
      const imagesByUrl=new Map();
      for(const page of pages) {
        page.countingObjectImages=[];
        for(const object of manifest.pages[page.pageNumber].objects) {
          const url=new URL(object.src,new URL(manifestUrl,location.href)).href;
          if(!imagesByUrl.has(url)) {
            const image=new Image();
            await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});
            await image.decode(); imagesByUrl.set(url,image);
          }
          page.countingObjectImages.push({...object,image:imagesByUrl.get(url),width:object.contentBounds[2],height:object.contentBounds[3]});
        }
      }
    } else {
      for(const page of pages) await ensurePdfCountingObjectsLoaded(page);
    }
    const savePng=name=>require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(output)},name),Buffer.from(canvas.toDataURL('image/png').split(',')[1],'base64'));
    const checkpoints=[];
    for(let pageIndex=0;pageIndex<pages.length;pageIndex++) {
      const page=pages[pageIndex],starts=state.pdf.narration.pdfTiming[pageIndex].countStarts;
      for(const count of [0,1,2,page.countingActivity.count]) {
        state.pdf.currentTimeMs=count ? starts[count-1]+240 : pageIndex*pageDuration;
        // Use exact onset for 1/2 so the next spoken number is still hidden.
        if(count===1||count===2) state.pdf.currentTimeMs=starts[count-1];
        drawPdfCountingObjectScene(page,pageIndex);
        savePng('page-'+page.pageNumber+'-count-'+count+'.png');
        checkpoints.push({page:page.pageNumber,wanted:count,actual:getPdfCountingVisibleCount(page,pageIndex)});
      }
    }
    const getPdfPresentationPages=()=>pages;
    const getPdfSelectionIndexForTime=ms=>Math.min(pages.length-1,Math.floor(ms/pageDuration));
    const syncPdfPreviewPageFromTime=ms=>{state.previewPageIndex=getPdfSelectionIndexForTime(ms);};
    const updatePlaybackProgressUi=()=>{};
    const updateTaskProgressUi=()=>{};
    const getPdfExportBitrate=()=>4000000;
    const getEffectiveExportQuality=()=>'hd';
    const ensurePdfPageRenderImageLoaded=()=>{throw new Error('Original page must not be used in reveal export');};
    const drawn=[];
    function drawScene() {
      const index=getPdfSelectionIndexForTime(state.pdf.currentTimeMs), page=pages[index];
      if(!drawPdfCountingObjectScene(page,index)) throw new Error('Reveal renderer rejected prepared counting page');
      drawn.push({ms:state.pdf.currentTimeMs,page:page.pageNumber,count:getPdfCountingVisibleCount(page,index)});
    }
    ${encoder}
    let video=null;
    if(!${previewOnly}) {
      // All production image decodes and manifest checks are exercised above.
      const encoded=await encodePdfExactTimelineForExport({durationMs:pages.length*pageDuration,playbackRate:1,frameRate:30});
      require('node:fs').writeFileSync(require('node:path').join(${JSON.stringify(output)},'reveal-all-pages.ivf'),Buffer.from(await encoded.blob.arrayBuffer()));
      video={frameCount:encoded.frameCount,durationMs:encoded.durationMs,
        transitions:pages.map(page=>drawn.find(frame=>frame.page===page.pageNumber)),
        fullCounts:pages.map(page=>drawn.filter(frame=>frame.page===page.pageNumber).at(-1))};
    }
    return {previewOnly:${previewOnly},checkpoints,video};
  })()`);
  if (report.checkpoints.some(checkpoint => checkpoint.wanted !== checkpoint.actual)) throw new Error('Wrong visible count in renderer QA');
  fs.writeFileSync(path.join(output, previewOnly ? 'preview-report.json' : 'export-report.json'), JSON.stringify(report, null, 2));
  window.destroy(); server.close(); clearTimeout(timeout); app.quit();
}).catch(error => {
  fs.writeFileSync(path.join(output, 'error.txt'), String(error?.stack || error));
  console.error(error); server.close(); clearTimeout(timeout); app.exit(1);
});
