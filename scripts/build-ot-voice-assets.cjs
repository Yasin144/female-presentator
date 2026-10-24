// Package the same reviewed PCM phrases used by the browser. No network/TTS dependency.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/components/OtSalary/timeCompletedVoice.js'), 'utf8');
const output = path.join(root, 'android/app/src/main/res/raw');
fs.mkdirSync(output, { recursive: true });
for (let h = 0; h <= 8; h++) {
  const match = source.match(new RegExp('"ot_' + h + '": "([A-Za-z0-9+/=]+)"'));
  if (!match) throw new Error('Missing OT phrase ' + h);
  const phrase = Buffer.from(match[1], 'base64');
  if (!phrase.length || phrase.length % 2 || phrase.length > 48000) throw new Error('Invalid 12kHz PCM phrase');
  const pcm = Buffer.concat([phrase, Buffer.alloc(4800)]); // 200ms tail; never truncate a spoken word.
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(12000, 24); wav.writeUInt32LE(24000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  fs.writeFileSync(path.join(output, `ot_milestone_${h}.wav`), wav);
}
console.log('Packaged 9 complete OT voice clips with a 200ms tail.');
