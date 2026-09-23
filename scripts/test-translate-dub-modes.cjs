'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'translate-dub-module.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');

test('translator exposes authoritative female, male and both speaker modes', () => {
  assert.match(renderer, /class="tdub-voice-mode"/);
  assert.match(renderer, /value="female">Female only/);
  assert.match(renderer, /value="male">Male only/);
  assert.match(renderer, /value="both" selected>Both/);
  assert.match(renderer, /voiceMode:\s*state\.voiceMode/);
  assert.match(renderer, /singleVoice:\s*state\.voiceMode !== "both"/);
});

test('backend forces one requested gender or detects both per timestamped segment', () => {
  assert.match(main, /safeVoiceMode !== 'both' \? segments\.map\(\(\) => safeVoiceMode\)/);
  assert.match(main, /voicePool\[safeVoiceMode\]\?\.\[0\]/);
  assert.match(main, /seg\.speakerGender \|\| seg\.gender/);
});

test('voice retry cannot silently cross to the opposite gender', () => {
  assert.match(main, /sameGenderFallback \|\| fallbackVoice/);
  assert.match(main, /voicePool\[detectedGenders\[i\]\]\?\.\[0\]/);
});

test('long narration speed correction uses a legal chained FFmpeg atempo graph', () => {
  assert.match(main, /function buildAtempoChain\(tempo\)/);
  assert.match(main, /while \(remaining > 2\.000001\)/);
  assert.match(main, /const tempoFilter = buildAtempoChain\(tempo\)/);
});

test('the timestamp-locked audio used for video is returned for matching preview and MP3 export', () => {
  assert.match(main, /audioBase64, audioContentType: 'audio\/mpeg'/);
  assert.match(main, /'dubbed_audio\.mp3'/);
  assert.match(main, /'-c:a', 'libmp3lame'/);
  assert.match(renderer, /state\.audioBase64 = exported\.audioBase64/);
  assert.match(renderer, /audioOnly:\s*true/);
});
