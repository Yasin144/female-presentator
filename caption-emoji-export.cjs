'use strict';
const fs = require('node:fs');
const path = require('node:path');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const number = value => Number(value.toFixed(6)).toString();
const interval = event => `gte(t,${number(event.start)})*lt(t,${number(event.end)})`;
const bounce = event => `if(lt(t,${number(event.bounceStart + .2)}),0.5+0.7*sin(max(0,t-(${number(event.bounceStart)}))*PI/0.4),1.2)`;

function prepareCaptionEmojiExport(subFilter, overlays, workDir) {
  if (!Array.isArray(overlays) || !overlays.length) {
    return { inputArgs: [], videoArgs: ['-map', '0:v:0', '-vf', subFilter] };
  }
  if (overlays.length > 64) throw new Error('Too many caption emoji images.');
  const inputArgs = [];
  const filters = [`[0:v:0]${subFilter},format=rgba[caption-base]`];
  let previous = 'caption-base';
  for (const [index, sprite] of overlays.entries()) {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(sprite.pngDataUrl || ''));
    if (!match || match[1].length > 8 * 1024 * 1024) throw new Error('Invalid caption emoji PNG.');
    const png = Buffer.from(match[1], 'base64');
    if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)
        || png.toString('ascii', 12, 16) !== 'IHDR'
        || !png.readUInt32BE(16) || !png.readUInt32BE(20)
        || png.readUInt32BE(16) > 2048 || png.readUInt32BE(20) > 2048) {
      throw new Error('Invalid caption emoji image dimensions.');
    }
    if (!Array.isArray(sprite.events) || !sprite.events.length || sprite.events.length > 1000) {
      throw new Error('Invalid caption emoji timeline.');
    }
    const events = sprite.events.map(event => {
      for (const key of ['start', 'end', 'x', 'y', 'offsetY', 'bounceStart']) {
        if (typeof event[key] !== 'number' || !Number.isFinite(event[key]) || Math.abs(event[key]) > 1000000) {
          throw new Error('Invalid caption emoji placement.');
        }
      }
      if (event.start < 0 || event.end <= event.start) throw new Error('Invalid caption emoji timing.');
      return event;
    });
    const choose = (value, fallback) => events.reduceRight((expression, event) =>
      `if(${interval(event)},${value(event)},${expression})`, fallback);
    const scale = choose(bounce, '1.2');
    const x = choose(event => number(event.x), '0');
    const y = choose(event => `${number(event.y)}+(${number(event.offsetY)})*(${bounce(event)})`, '0');
    const enable = events.map(interval).join('+');
    const imagePath = path.join(workDir, `emoji-${index}.png`);
    fs.writeFileSync(imagePath, png, { flag: 'wx' });
    inputArgs.push('-loop', '1', '-framerate', '60', '-i', imagePath);
    filters.push(`[${index + 1}:v]format=rgba,scale=w='round(iw*(${scale}))':h='round(ih*(${scale}))':eval=frame[emoji-${index}]`);
    const next = `caption-emoji-${index}`;
    filters.push(`[${previous}][emoji-${index}]overlay=x='(${x})-overlay_w/2':y='(${y})-overlay_h/2':enable='${enable}':format=rgb:alpha=straight:shortest=1[${next}]`);
    previous = next;
  }
  filters.push(`[${previous}]null[captioned-video]`);
  const filterPath = path.join(workDir, 'emoji-filter.txt');
  fs.writeFileSync(filterPath, filters.join(';\n'), { flag: 'wx' });
  return { inputArgs, videoArgs: ['-filter_complex_script', filterPath, '-map', '[captioned-video]'] };
}

module.exports = { prepareCaptionEmojiExport };
