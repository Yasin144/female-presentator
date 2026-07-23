'use strict';

const fs = require('fs');

function writeWavFile(filePath, samples, sampleRate = 44100) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  // Format chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  // Data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);

  // Write samples
  for (let i = 0; i < samples.length; i++) {
    const val = Math.max(-1, Math.min(1, samples[i]));
    const sample = Math.max(-32768, Math.min(32767, Math.floor(val * 32767)));
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function generateDing(filePath) {
  const sampleRate = 44100;
  const duration = 0.8;
  const totalSamples = sampleRate * duration;
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-6.5 * t);
    samples[i] = Math.sin(2 * Math.PI * 987.77 * t) * env * 0.7; // B5 note
  }
  writeWavFile(filePath, samples, sampleRate);
}

function generateClick(filePath) {
  const sampleRate = 44100;
  const duration = 0.08;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-80 * t);
    const noise = Math.random() * 2 - 1;
    samples[i] = noise * env * 0.6;
  }
  writeWavFile(filePath, samples, sampleRate);
}

function generateWhoosh(filePath) {
  const sampleRate = 44100;
  const duration = 0.7;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // Frequency sweeps from 180Hz to 1600Hz then down to 180Hz
    const centerT = duration / 2;
    const sweep = Math.exp(-Math.pow((t - centerT) * 5, 2));
    const freq = 180 + 1420 * sweep;
    
    // Waveform: Sine wave + modulated noise
    const sine = Math.sin(2 * Math.PI * freq * t);
    const noise = (Math.random() * 2 - 1) * 0.45;
    
    const env = Math.sin(Math.PI * (t / duration)); // parabolic envelope
    samples[i] = (sine * 0.35 + noise * 0.65) * env * 0.85;
  }
  writeWavFile(filePath, samples, sampleRate);
}

function generateCheer(filePath) {
  const sampleRate = 44100;
  const duration = 2.5;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  // Synthesize applause using dense overlapping grains of noise
  const grains = [];
  const grainCount = 380;
  for (let g = 0; g < grainCount; g++) {
    const startTime = Math.random() * (duration - 0.25);
    const grainLen = 0.04 + Math.random() * 0.08;
    grains.push({ startTime, grainLen });
  }

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let val = 0;
    for (let g = 0; g < grainCount; g++) {
      const grain = grains[g];
      if (t >= grain.startTime && t <= grain.startTime + grain.grainLen) {
        const gt = t - grain.startTime;
        const env = Math.sin(Math.PI * (gt / grain.grainLen));
        val += (Math.random() * 2 - 1) * env * 0.035;
      }
    }
    // Main fade-in fade-out envelope
    const env = Math.sin(Math.PI * (t / duration));
    samples[i] = val * env * 1.5;
  }
  writeWavFile(filePath, samples, sampleRate);
}

function generateTyping(filePath) {
  const sampleRate = 44100;
  const duration = 1.2;
  const totalSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(totalSamples);

  // Generate 8 key clicks at random intervals
  const clicks = [0.1, 0.22, 0.38, 0.5, 0.65, 0.78, 0.95, 1.1];
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let val = 0;
    for (const clickTime of clicks) {
      if (t >= clickTime && t <= clickTime + 0.02) {
        const dt = t - clickTime;
        const env = Math.exp(-220 * dt);
        val += (Math.random() * 2 - 1) * env * 0.45;
      }
    }
    samples[i] = val;
  }
  writeWavFile(filePath, samples, sampleRate);
}

module.exports = {
  generateDing,
  generateClick,
  generateWhoosh,
  generateCheer,
  generateTyping
};
