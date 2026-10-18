const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const source = fs.readFileSync('caption-script.js', 'utf8');
let body;
traverse(parser.parse(source), { FunctionDeclaration(p) {
  if (p.node.id.name === 'inspectCaptionQuality') body = source.slice(p.node.start, p.node.end);
} });
const inspect = vm.runInNewContext(body + '\ninspectCaptionQuality');
test('quality review flags gaps, overlapping words and estimated highlighting without editing captions', () => {
  const cues = [{text:'Info Kids',timestamp:[4,6],words:[{text:'Info',timestamp:[4,5.5]},{text:'Kids',timestamp:[5,6]}]},
    {text:'Time for grammar',timestamp:[9,11]}];
  const original = JSON.stringify(cues);
  const result = inspect(cues, 16, 'estimated');
  assert.equal(result.wordCount, 5);
  assert.ok(result.issues.some(issue => issue.includes('6.0–9.0')));
  assert.ok(result.issues.some(issue => issue.includes('Uncertain word')));
  assert.ok(result.issues.some(issue => issue.includes('estimated')));
  assert.ok(result.issues.some(issue => issue.includes('ending')));
  assert.equal(JSON.stringify(cues), original);
});
test('valid short sentences and ordinary pauses pass review', () => {
  const result = inspect([{text:'Example',timestamp:[1,1.4],words:[{text:'Example',timestamp:[1,1.4]}]},
    {text:'The bird sings',timestamp:[2,3]}], 3, 'word');
  assert.equal(result.issues.length, 0);
});
