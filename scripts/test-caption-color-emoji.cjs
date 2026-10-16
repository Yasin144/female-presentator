'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { prepareCaptionEmojiExport } = require('../caption-emoji-export.cjs');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'caption-script-v2.js'), 'utf8').replace(/cap2_/g, '');
const functions = new Map();
traverse(parser.parse(source), { FunctionDeclaration(p) { functions.set(p.node.id.name, source.slice(p.node.start, p.node.end)); } });
const names = ['fitCaptionBlock', 'getCaptionFontFamily', 'getCaptionSourceFontSize', 'getCaptionWordTimeline', 'getCaptionWordEnd',
  'getCaptionActiveWordIndex', 'getVisibleCaptionText', 'getWrappedCaptionLines', 'drawWrappedText',
  'getCaptionEmojiBitmap', 'addCaptionEmojiOverlay', 'stripIgnoredIntroCaption', 'removeIgnoredIntroCaptions',
  'toAssTimestamp', 'escapeAssCaptionText', 'hexToAss', 'getAssStyleConfig', 'buildPreviewMatchedAss', 'buildPreviewMatchedExport'];
const production = names.map(name => functions.get(name)).join('\n');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const event = { start: .2, end: 1.8, x: 960, y: 972, offsetY: -80, bounceStart: .2 };
test('no emoji leaves the native subtitle and original-video mapping unchanged', () => {
  assert.deepEqual(prepareCaptionEmojiExport('subtitles=test.ass', [], ''), {
    inputArgs: [], videoArgs: ['-map', '0:v:0', '-vf', 'subtitles=test.ass'],
  });
});
test('color PNGs use timed RGBA overlays, animation and a filter script', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-emoji-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const args = prepareCaptionEmojiExport('subtitles=test.ass', [{ pngDataUrl: png, events: [event] }], directory);
  assert.equal(args.inputArgs[0], '-loop');
  assert.equal(args.videoArgs[0], '-filter_complex_script');
  const script = fs.readFileSync(args.videoArgs[1], 'utf8');
  assert.match(script, /format=rgba/);
  assert.match(script, /sin\(max\(0,t-\(0\.2\)\)\*PI\/0\.4\)/);
  assert.match(script, /gte\(t,0\.2\)\*lt\(t,1\.8\)/);
  assert.match(script, /alpha=straight:shortest=1/);
  assert.equal(args.videoArgs.at(-1), '[captioned-video]');
});
test('invalid images and nonnumeric placements cannot enter FFmpeg expressions', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-emoji-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => prepareCaptionEmojiExport('null', [{ pngDataUrl: 'data:image/png;base64,eA==', events: [event] }], directory), /Invalid caption emoji/);
  assert.throws(() => prepareCaptionEmojiExport('null', [{ pngDataUrl: png, events: [{ ...event, x: 'evil;filter' }] }], directory), /placement/);
  assert.throws(() => prepareCaptionEmojiExport('null', [{ pngDataUrl: png, events: [{ ...event, end: .1 }] }], directory), /timing/);
});
test('both local export routes send the color sprite payload rather than emoji ASS glyphs', () => {
  assert.equal((source.match(/\.\.\.buildPreviewMatchedExport\(\)/g) || []).length, 2);
  assert.doesNotMatch(functions.get('buildPreviewMatchedAss'), /\\fnSegoe UI Emoji/);
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(main, /prepareCaptionEmojiExport\(subFilter, emojiOverlays, emojiWorkDir\)/);
  assert.match(main, /\.\.\.emojiExport\.videoArgs,[\s\S]*?'-map', '0:a\?'/);
});

test('actual FFmpeg frames keep colored emoji, bright white text, outline and one yellow word', {
  skip: !process.env.CAPTION_RENDER_CHECK,
}, async () => {
  const puppeteer = require('puppeteer');
  const executablePath = [process.env.CAPTION_TEST_BROWSER, puppeteer.executablePath(),
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].find(file => file && fs.existsSync(file));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-emoji-render-'));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, executablePath });
    const page = await browser.newPage();
    const fonts = ['Regular', 'Black'].map(name => fs.readFileSync(path.join(root, 'public', 'caption-fonts', `Nunito-${name}.ttf`)).toString('base64'));
    const fixture = await page.evaluate(async ({ production, fonts }) => {
      for (const [index, data] of fonts.entries()) {
        const face = new FontFace('Pattan Caption Nunito', `url(data:font/ttf;base64,${data})`, { weight: index ? '900' : '400' });
        document.fonts.add(await face.load());
      }
      const CAPTION_WORD_LIMIT = 8, CAPTION_BOTTOM_OFFSET_PX = 80, SHORT_CAPTION_GAP_SECONDS = .75,
        CAPTION_PREVIEW_MAX_DIM = 1920, QUEUE_EXPORT_FONT_SIZE = 50;
      const captionEmojiCache = new Map();
      const sourceVideo = { videoWidth: 1920, videoHeight: 1080, duration: 3.8 }, renderCanvas = {};
      const sizeSlider = { value: 50 }, styleSelect = { value: 'white-yellow' }, colorPicker = { value: '#fde047' },
        strokeSlider = { value: 0 }, gapSlider = { value: 120 }, widthSlider = { value: 85 },
        fontSelect = { value: 'Nunito, sans-serif' }, boldCheck = { checked: true }, heightSlider = { value: 100 },
        karaokeCheck = { checked: true }, emojiCheck = { checked: true }, progressCheck = { checked: false };
      const captionPosX = .5, captionPosY = .9, getCaptionSyncOffsetSeconds = () => 0;
      const getEmojiForText = text => text.includes('summer') ? '\u{1f975}' : null;
      const generatedCaptions = [
        { text: 'On a hot summer day, a bee felt', timestamp: [.2, 1.8] },
        { text: 'Tiny flying insect slipped into the stream.', timestamp: [2, 3.6] },
      ];
      const api = eval(production + '\n({ buildPreviewMatchedExport, drawWrappedText, getCaptionFontFamily, getCaptionActiveWordIndex })');
      const previews = [];
      for (const time of [0, .2, .28, .44, .84, 1.92, 2.4]) {
        const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#477788'; ctx.fillRect(0, 0, 1920, 1080);
        ctx.font = `900 50px ${api.getCaptionFontFamily()}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const cap = generatedCaptions.find(cap => time >= cap.timestamp[0] && time < cap.timestamp[1]);
        if (cap) api.drawWrappedText(ctx, cap.text, 960, 972, 1920 * .85, 60, time - cap.timestamp[0],
          'white-yellow', api.getCaptionActiveWordIndex(cap, time), getEmojiForText(cap.text), 50, null, true);
        previews.push({ time, png: canvas.toDataURL('image/png') });
      }
      return { payload: api.buildPreviewMatchedExport(), previews };
    }, { production, fonts });
    assert.equal(fixture.payload.emojiOverlays.length, 1);
    assert.equal(fixture.payload.emojiOverlays[0].events.length, 1, 'adjacent word intervals share one color sprite');
    const assPath = path.join(directory, 'captions.ass');
    fs.writeFileSync(assPath, fixture.payload.assContent);
    const escape = file => file.replace(/\\/g, '/').replace(/:/g, '\\:');
    const encoding = prepareCaptionEmojiExport(`subtitles='${escape(assPath)}':fontsdir='${escape(path.join(root, 'public', 'caption-fonts'))}'`,
      fixture.payload.emojiOverlays, directory);
    const ffmpeg = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    execFileSync(ffmpeg, ['-v', 'warning', '-f', 'lavfi', '-i', 'color=c=0x477788:s=1920x1080:r=25:d=3.8',
      ...encoding.inputArgs, ...encoding.videoArgs, '-frames:v', '95', '-y', path.join(directory, 'frame-%03d.png')],
    { timeout: 90000, stdio: 'pipe', maxBuffer: 2 * 1024 * 1024 });
    const pairs = fixture.previews.map(preview => ({ time: preview.time, sources: [preview.png,
      'data:image/png;base64,' + fs.readFileSync(path.join(directory, `frame-${String(Math.round(preview.time * 25) + 1).padStart(3, '0')}.png`)).toString('base64')] }));
    const results = await page.evaluate(async pairs => {
      const all = [];
      for (const pair of pairs) {
        const measurements = [];
        for (const src of pair.sources) {
          const bitmap = await createImageBitmap(await (await fetch(src)).blob());
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const m = { red: 0, blue: 0, white: 0, yellow: 0, edge: 0,
            emoji: { left: Infinity, top: Infinity, right: 0, bottom: 0 } };
          for (let y = 700; y < 1020; y++) for (let x = 350; x < 1600; x++) {
            const i = (y * canvas.width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
            if (y < 940 && x > 880 && x < 1040) {
              const red = r > 150 && r > g * 1.5 && r > b * 1.4;
              const blue = b > 170 && b > r * 1.3;
              if (red) m.red++;
              if (blue) m.blue++;
              if (red || blue) { const box = m.emoji; box.left = Math.min(box.left, x); box.top = Math.min(box.top, y);
                box.right = Math.max(box.right, x); box.bottom = Math.max(box.bottom, y); }
            }
            if (y >= 940) {
              if (r > 245 && g > 245 && b > 245) m.white++;
              if (r > 220 && g > 170 && b < 120) m.yellow++;
              if (r < 40 && g < 45 && b < 50) m.edge++;
            }
          }
          measurements.push(m);
        }
        all.push({ time: pair.time, measurements });
      }
      return all;
    }, pairs);
    console.log('Color emoji frame checks:', JSON.stringify(results));
    for (const { time, measurements: [preview, exported] } of results) {
      if (time >= .2 && time < 1.8) {
        assert.ok(exported.red > 20 && exported.blue > 5, `emoji colors missing at ${time}`);
        for (const edge of ['left', 'top', 'right', 'bottom']) {
          assert.ok(Math.abs(preview.emoji[edge] - exported.emoji[edge]) <= 4, `emoji ${edge} differs at ${time}`);
        }
      } else assert.equal(exported.red + exported.blue, 0, `emoji leaks outside its caption at ${time}`);
      if (time >= .2 && time < 1.8 || time >= 2 && time < 3.6) {
        for (const key of ['white', 'yellow', 'edge']) {
          assert.ok(exported[key] > 100, `${key} caption missing at ${time}`);
          assert.ok(exported[key] / preview[key] > .7 && exported[key] / preview[key] < 1.3, `${key} color differs at ${time}`);
        }
      } else assert.equal(exported.white + exported.yellow + exported.edge, 0);
    }
    fs.copyFileSync(path.join(directory, 'frame-022.png'), path.join(root, 'temp', 'caption-color-emoji-verified.png'));
    fs.writeFileSync(path.join(root, 'temp', 'caption-color-emoji-preview.png'), Buffer.from(fixture.previews[4].png.split(',')[1], 'base64'));

    // Exercise the real MP4 route with two PNG inputs, not just a single rendered frame.
    const sourceVideo = path.join(directory, 'source.mp4'), exportedVideo = path.join(directory, 'export.mp4');
    execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x477788:s=1920x1080:r=25:d=0.8',
      '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.8', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', sourceVideo], { timeout: 30000, stdio: 'pipe' });
    const secondDir = path.join(directory, 'two-sprites'); fs.mkdirSync(secondDir);
    const secondSprite = { ...fixture.payload.emojiOverlays[0], events: [{ ...event, start: .6, end: .8, x: 1200 }] };
    const multi = prepareCaptionEmojiExport(`subtitles='${escape(assPath)}':fontsdir='${escape(path.join(root, 'public', 'caption-fonts'))}'`,
      [...fixture.payload.emojiOverlays, secondSprite], secondDir);
    execFileSync(ffmpeg, ['-v', 'error', '-i', sourceVideo, ...multi.inputArgs, ...multi.videoArgs,
      '-map', '0:a?', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'copy',
      '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', '-y', exportedVideo], { timeout: 30000, stdio: 'pipe' });
    const ffprobe = path.join(path.dirname(ffmpeg), 'ffprobe.exe');
    const metadata = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration',
      '-of', 'json', exportedVideo], { encoding: 'utf8' }));
    assert.deepEqual(metadata.streams.map(stream => stream.codec_type), ['video', 'audio']);
    assert.ok(Math.abs(Number(metadata.format.duration) - .8) < .1, 'PNG loops must not prolong the export');
    const audioHashes = file => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0',
      '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', file],
    { encoding: 'utf8' })).packets.map(packet => packet.data_hash);
    assert.deepEqual(audioHashes(exportedVideo), audioHashes(sourceVideo), 'original audio is copied unchanged');
  } finally {
    if (browser) await browser.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
