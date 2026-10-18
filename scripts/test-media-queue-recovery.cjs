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
async function exercise({ failures = 1, exportFailure = '', empty = false, timingFailure = false, probeVersion = 1 } = {}) {
  let calls = 0, exports = 0; const waits = [], probes = [];
  const ctx = {
    captionVideoQueue: [{file:{name:'song.mp4',path:'D:/song.mp4'},status:'ready',captions:[],warnings:[]}],
    captionQueueRunning:false,captionQueueExporting:false,captionQueueMode:'',captionQueueIndex:0,generatedCaptions:[],
    captionTranscriptionCancelRequested:false,activeCaptionTranscription:null,cancelBtn:null,
    sourceVideo:{duration:20},statusText:{innerHTML:'',textContent:''},console:{error(){}},
    document:{getElementById:()=>null},
    captionLocalBusy:()=>false,getCaptionOutputLanguage:()=> 'en',
    getCaptionTranscriptionOptions:()=>({engine:timingFailure?'groq':'local',contentMode:'speech'}),isSongCaptionMode:()=>false,
    createCaptionWhatsAppJob:()=>()=>{},lockCaptionQueueControls(){},renderCaptionQueue(){},loadQueuedCaptionVideo(){},
    waitForQueueVideoReady:async()=>{},startQueueProgressHeartbeat:()=>1,clearInterval(){},
    setCaptionProgressBar(){},speakCaptionStudio(){},notifyCaptionStudio(){},
    setTimeout(resolve,ms){waits.push(ms);resolve();},
    window:{electronAPI:{async transcribeVideo(request){
      if(request.capabilityProbe){probes.push(request);return probeVersion?{ok:true,groqSpeechTimingRepairVersion:probeVersion}:{ok:false,error:'No video path provided.'};}
      calls++;return calls <= failures ? {ok:false,error:'Request timed out'} : {ok:true};
    }}},
    buildCaptionChunksFromTranscription:()=>{
      if(timingFailure){const error=new Error('Speech timestamps conflict at word 20. Generate captions again; the previous captions are preserved.');error.captionTimingFailure=true;throw error;}
      return empty?[]:[{text:'actual lyrics',timestamp:[0,1]}];
    },
    normalizeCaptionLanguageCode:()=> 'en',inferCaptionLanguageCode:()=> 'en',
    captionMetadataFromTranscription(){ctx.captionVideoQueue[0].timingSource='word';},
    prepareCaptionOutput:async captions=>({captions,outputLanguage:'en',timingSource:'word',warnings:[]}),
    applyCaptionOutputMetadata(item,output){Object.assign(item,{outputLanguage:output.outputLanguage,timingSource:output.timingSource,warnings:output.warnings});},
    setQueueItemState(i,patch){ctx.captionVideoQueue[i]={...ctx.captionVideoQueue[i],...patch};},
    async exportActiveCaptionVideoForQueue(i){exports++;if(exportFailure)throw new Error(exportFailure);ctx.captionVideoQueue[i].status='exported';},
  };
  vm.createContext(ctx);
  await vm.runInContext(extract('explainCaptionTimingFailure')+'\n'+extract('isRetryableCaptionQueueError')+'\n'+extract('transcribeCaptionQueueFrom')+'\ntranscribeCaptionQueueFrom()',ctx);
  assert.equal(ctx.captionQueueRunning,false);assert.equal(ctx.captionQueueExporting,false);
  return {ctx,calls,exports,waits,probes};
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
test('a timing failure remains visible in the final queue status and is never a paid retry',async()=>{
  const r=await exercise({failures:0,timingFailure:true,probeVersion:0});
  assert.equal(r.calls,1);assert.equal(r.exports,0);assert.deepEqual(r.waits,[]);
  assert.deepEqual(JSON.parse(JSON.stringify(r.probes)),[{engine:'groq',contentMode:'speech',capabilityProbe:true}]);
  assert.equal(r.ctx.captionVideoQueue.length,1);
  assert.equal(r.ctx.captionVideoQueue[0].file.path,'D:/song.mp4');
  assert.match(r.ctx.captionVideoQueue[0].message,/Speech timestamps conflict at word 20.*Close and reopen/);
  assert.match(r.ctx.captionVideoQueue[0].message,/No export started\./);
  assert.match(r.ctx.statusText.textContent,/Exported 0\/1.*song\.mp4: Speech timestamps conflict at word 20.*Close and reopen/);
});
test('valid repaired queue results do not require the optional capability route',async()=>{
  const r=await exercise({failures:0,probeVersion:0});
  assert.equal(r.calls,1);assert.equal(r.exports,1);assert.deepEqual(r.probes,[]);
});
test('Sing Song holds ownership during retry delay and checks stop before resuming',()=>{
  const script=read('script.js');const block=script.slice(script.indexOf('if (_toRetry.length > 0)'),script.indexOf('// ── Final summary'));
  assert.ok(block.indexOf('sc3Queue.processing = true') < block.indexOf('setTimeout'));
  assert.ok(block.indexOf('if (sc3Queue.stopped)') < block.indexOf('_toRetry.forEach'));
  assert.match(script,/function handleSc3VideoSelection\(event\) \{\s*if \(sc3Queue.processing/);
  assert.match(read('main.cjs'),/sc3Recovery.timedSections\(transcriptParts, sourceSeconds\)/);
  assert.match(read('main.cjs'),/generationOptions: \{ regenerationKey \} \}, 900000/);
});
