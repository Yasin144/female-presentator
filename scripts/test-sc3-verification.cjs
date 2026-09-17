const test = require('node:test');
const assert = require('node:assert/strict');
const {compareNarration,verifyNarration,recoveryPhrases} = require('../sc3-recovery.cjs');
const {preserveSourceSound} = require('../sc3-recovery.cjs');
test('brief source sounds are preserved without exempting real narration from verification',()=>{
  assert.equal(preserveSourceSound({text:'Um.',start:38.26,end:38.42}),true);
  assert.equal(preserveSourceSound({text:'Choo -choo!',start:33.98,end:34.9}),true);
  for(const text of ['eleven dogs','Stop!','The colors are disappearing','eleven','Um, the colors']) {
    assert.equal(preserveSourceSound({text,start:0,end:.16}),false,text);
  }
});
test('verification flags omitted, repeated, substituted and reordered words',()=>{
  for(const text of ['the colors disappearing','the colors colors are disappearing','the colors are appearing','colors the are disappearing','']) {
    assert.equal(compareNarration('The colors are disappearing.',text).ok,false,text);
  }
  assert.equal(compareNarration("Let's restore the colours!",'Let us restore the colors.').ok,true);
  assert.equal(compareNarration('eleven dogs','twelve dogs').ok,false);
});
test('mismatched narration is regenerated and only matching audio is accepted',async()=>{
  const attempts=[];
  const audio=await verifyNarration('eleven dogs',async attempt=>{
    attempts.push(attempt);return {text:attempt===0?'twelve dogs':'eleven dogs',audio:Buffer.from(String(attempt))};
  });
  assert.deepEqual(attempts,[0,1]);assert.equal(audio.toString(),'1');
});
test('persistent mismatch stops after bounded recovery and explains difference',async()=>{
  let count=0;
  await assert.rejects(verifyNarration('eleven dogs',async()=>{count++;return {text:'dogs',audio:Buffer.from('bad')};}),/review required.*eleven dogs.*dogs.*6 attempts/);
  assert.equal(count,6);
});

test('fourth attempt can recover and splitting preserves all words in order',async()=>{
  const phrase='The rainbow color crystal has lost all of its magical power today.';
  for(const attempt of [3,4,5]) {
    const parts=recoveryPhrases(phrase,attempt);
    assert.equal(parts.join(' '),phrase);
    assert.ok(parts.every(p=>p.split(/\s+/).length <= [8,5,3][attempt-3]));
  }
  let calls=0;
  const audio=await verifyNarration(phrase,async attempt=>{calls++;return {text:attempt>=3?phrase:'wrong words',audio:Buffer.from('recovered')};});
  assert.equal(calls,4);assert.equal(audio.toString(),'recovered');
});
