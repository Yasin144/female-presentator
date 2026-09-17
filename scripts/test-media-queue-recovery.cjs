const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const read = file => fs.readFileSync(require('node:path').join(__dirname, '..', file), 'utf8');
const source = read('caption-script.js');
const ast = parser.parse(source);
function extract(name) {
  let result;
  traverse(ast, { FunctionDeclaration(p) { if (p.node.id?.name === name) result = source.slice(p.node.start, p.node.end); } });
  assert.ok(result, name); return result;
}
const retry = vm.runInNewContext('(' + extract('isRetryableCaptionQueueError') + ')');
test('retry policy distinguishes temporary failures from cancellation and bad input', () => {
  for (const message of ['Request timed out', 'ECONNRESET', 'server unavailable', 'worker exited', '503 busy']) assert.equal(retry(new Error(message)), true, message);
  for (const message of ['Export cancelled after preview', 'No recognizable speech or lyrics', 'File not found', 'ENOSPC', 'out of memory']) assert.equal(retry(new Error(message)), false, message);
});
async function exercise({ failures = 1, exportFailure = '', empty = false } = {}) {
  let calls = 0, exports = 0; const waits = [];
  const ctx = {
    captionVideoQueue: [{file:{name:'song.mp4',path:'D:/song.mp4'},status:'ready'}],
    captionQueueRunning:false,captionQueueExporting:false,captionQueueMode:'',captionQueueIndex:0,generatedCaptions:[],
    sourceVideo:{duration:20},statusText:{innerHTML:''},console:{error(){}},
    document:{getElementById:()=>null},
    createCaptionWhatsAppJob:()=>()=>{},lockCaptionQueueControls(){},renderCaptionQueue(){},loadQueuedCaptionVideo(){},
    waitForQueueVideoReady:async()=>{},startQueueProgressHeartbeat:()=>1,clearInterval(){},
    setCaptionProgressBar(){},speakCaptionStudio(){},notifyCaptionStudio(){},
    setTimeout(resolve,ms){waits.push(ms);resolve();},
    window:{electronAPI:{async transcribeVideo(){calls++;return calls <= failures ? {ok:false,error:'Request timed out'} : {ok:true};}}},
    buildCaptionChunksFromTranscription:()=>empty?[]:[{text:'actual lyrics',timestamp:[0,1]}],
    setQueueItemState(i,patch){ctx.captionVideoQueue[i]={...ctx.captionVideoQueue[i],...patch};},
    async exportActiveCaptionVideoForQueue(i){exports++;if(exportFailure)throw new Error(exportFailure);ctx.captionVideoQueue[i].status='exported';},
  };
  vm.createContext(ctx);
  await vm.runInContext(extract('isRetryableCaptionQueueError')+'\n'+extract('transcribeCaptionQueueFrom')+'\ntranscribeCaptionQueueFrom()',ctx);
  assert.equal(ctx.captionQueueRunning,false);assert.equal(ctx.captionQueueExporting,false);
  return {ctx,calls,exports,waits};
}
test('temporary transcription failure retries and exports once',async()=>{
  const r=await exercise();assert.equal(r.calls,2);assert.equal(r.exports,1);assert.equal(r.ctx.captionVideoQueue[0].status,'exported');
});
test('retry cap stops persistent errors',async()=>{
  const r=await exercise({failures:99});assert.equal(r.calls,3);assert.deepEqual(r.waits,[3000,6000]);assert.equal(r.ctx.captionVideoQueue[0].status,'failed');
});
test('export retries preserve generated captions',async()=>{
  const r=await exercise({failures:0,exportFailure:'socket closed'});assert.equal(r.calls,1);assert.equal(r.exports,3);
});
test('preview cancellation preserves review state without retry',async()=>{
  const r=await exercise({failures:0,exportFailure:'Export cancelled after preview. Your captions are preserved.'});assert.equal(r.exports,1);assert.equal(r.ctx.captionVideoQueue[0].status,'transcribed');assert.deepEqual(r.waits,[]);
});
test('instrumental or unrecognized audio is not repeatedly transcribed',async()=>{
  const r=await exercise({failures:0,empty:true});assert.equal(r.calls,1);assert.equal(r.exports,0);assert.match(r.ctx.captionVideoQueue[0].message,/No recognizable/);
});
test('Sing Song holds ownership during retry delay and checks stop before resuming',()=>{
  const script=read('script.js');const block=script.slice(script.indexOf('if (_toRetry.length > 0)'),script.indexOf('// ── Final summary'));
  assert.ok(block.indexOf('sc3Queue.processing = true') < block.indexOf('setTimeout'));
  assert.ok(block.indexOf('if (sc3Queue.stopped)') < block.indexOf('_toRetry.forEach'));
  assert.match(script,/function handleSc3VideoSelection\(event\) \{\s*if \(sc3Queue.processing/);
  assert.match(read('main.cjs'),/sc3Recovery.timedSections\(transcriptParts, sourceSeconds\)/);
  assert.match(read('main.cjs'),/generationOptions: \{ regenerationKey \} \}, 900000/);
});
