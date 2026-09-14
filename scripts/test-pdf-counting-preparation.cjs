const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const modulePromise = import(pathToFileURL(path.join(root, 'pdf-counting-preparation.js')).href);
const storagePromise = import(pathToFileURL(path.join(root, 'pdf-counting-local-store.js')).href);
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const library = JSON.parse(fs.readFileSync(path.join(root, 'assets/pdf-counting/library.json'), 'utf8'));
const knownFingerprint = source.match(/const PDF_COUNTING_DOCUMENT_ID = "([^"]+)"/)[1];
const pngData = 'data:image/png;base64,' + Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(48)
]).toString('base64');
const customAsset = overrides => ({
  id: 'custom:cats', noun: 'cats', aliases: ['cats', 'cat'], src: pngData,
  width: 96, height: 64, contentBounds: [2, 3, 92, 59], ...overrides
});
const originalReview = (fingerprint = 'unknown-pdf', pageNumber = 1) => ({
  id: `${fingerprint}:${pageNumber}`, fingerprint, pageNumber, mode: 'original'
});
const countingReview = (fingerprint = 'unknown-pdf', pageNumber = 1, overrides = {}) => ({
  id: `${fingerprint}:${pageNumber}`, fingerprint, pageNumber,
  mode: 'counting', count: 5, noun: 'stars', assetId: 'builtin:stars', ...overrides
});

function functionSource(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\r?\\n\\}`, 'm'));
  assert.ok(match, `Production function ${name} must exist`);
  return match[0];
}

async function fixture(options = {}) {
  const { createPdfCountingPreparation, validateBuiltinCountingLibrary } = await modulePromise;
  const { validatePdfCountingLocalAsset, validatePdfCountingPageReview } = await storagePromise;
  const assets = new Map(), reviews = new Map(), writes = [];
  const builtins = validateBuiltinCountingLibrary(structuredClone(library));
  const persistAsset = async asset => {
    const validated = validatePdfCountingLocalAsset(asset);
    if (options.assetGate) await options.assetGate.promise;
    if (options.failAsset) throw new Error('Synthetic local asset quota failure');
    assets.set(validated.id, structuredClone(validated));
    writes.push({ type: 'asset', id: validated.id });
    return validated;
  };
  const persistReview = async review => {
    const validated = validatePdfCountingPageReview(review);
    if (options.reviewGate) await options.reviewGate.promise;
    if (options.failReview) throw new Error('Synthetic local review disk failure');
    reviews.set(validated.id, structuredClone(validated));
    writes.push({ type: 'review', id: validated.id });
    return validated;
  };
  const reload = () => createPdfCountingPreparation({
    builtins, assets: [...assets.values()].map(value => structuredClone(value)),
    reviews: [...reviews.values()].map(value => structuredClone(value)),
    persistAsset, persistReview, storageWarning: options.storageWarning || ''
  });
  return { manager: reload(), reload, assets, reviews, writes, builtins };
}

function renderer(manager, options = {}) {
  const requestedUrls = [], decodedUrls = [], fetchedUrls = [];
  const state = { pdf: { countingDisplayMode: 'reveal' } };
  class FakeImage {
    set src(value) {
      this.url = value;
      requestedUrls.push(value);
      const custom = value.startsWith('data:');
      this.naturalWidth = options.badDimensions ? 32 : custom ? 96 : 1254;
      this.naturalHeight = custom ? 64 : 1254;
      queueMicrotask(() => this.onload());
    }
    async decode() {
      decodedUrls.push(this.url);
      await options.onDecode?.(this.url);
    }
  }
  const context = vm.createContext({
    URL, DOMException, Image: FakeImage, state, injectedPreparation: manager,
    document: { currentScript: { src: 'app://voice/script.js' }, baseURI: 'app://voice/' },
    normalizePdfLine: text => String(text).replace(/\u0000/g, '').replace(/[ \t\f\v]+/g, ' ').trim(),
    fetch: async url => { fetchedUrls.push(String(url)); throw new Error('Unknown PDFs must not fetch source-specific manifests or remote artwork'); }
  });
  const countingData = source.slice(source.indexOf('const PDF_COUNTING_WORDS ='), source.indexOf('function getPdfCountingStarts('));
  const loader = source.slice(source.indexOf('const pdfCountingManifestPromises ='), source.indexOf('async function preparePdfCountingObjects('));
  assert.ok(countingData && loader, 'Production counting and loader sections must exist');
  vm.runInContext([
    countingData, functionSource('getPdfCountingDisplayMode'), functionSource('getPdfCountingMarkerGeometry'),
    loader, functionSource('buildPdfCountingSetup'), 'pdfCountingPreparation = injectedPreparation;'
  ].join('\n'), context);
  const page = (text, fingerprint = 'unknown-pdf', pageNumber = 1) => ({
    index: pageNumber - 1, pageNumber, text,
    ...context.buildPdfCountingSetup(text, [], fingerprint, pageNumber)
  });
  return { context, state, page, requestedUrls, decodedUrls, fetchedUrls };
}

function assertNoSourceAnchors(context, activity) {
  assert.equal(activity.markersVerified, false);
  assert.equal(activity.markerPoints.length, 0);
  assert.equal(activity.markerLabels, null);
  assert.equal(context.getPdfCountingMarkerGeometry(activity, 0, 0, 1280, 720).length, 0);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('unknown PDFs automatically prepare 3 dogs, 1 dog, and 20 stars without source anchors', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  for (const [text, count, noun, assetId] of [
    ['3 dogs', 3, 'dogs', 'builtin:dogs'], ['1 dog', 1, 'dog', 'builtin:dogs'], ['20 stars', 20, 'stars', 'builtin:stars']
  ]) {
    const page = r.page(text, `new-pdf-${count}`, count);
    assert.equal(page.countingPreparation.status, 'ready');
    assert.equal(page.countingActivity.objectSource, 'local-library');
    assert.equal(page.countingActivity.objectAssetId, assetId);
    assert.equal(page.countingActivity.count, count);
    assert.equal(page.countingActivity.noun, noun);
    assert.equal(page.countingActivity.objectDocumentId, `new-pdf-${count}`);
    assert.equal(page.countingActivity.objectPageNumber, count);
    assert.equal(r.context.shouldRevealPdfCountingObjects(page), true);
    assertNoSourceAnchors(r.context, page.countingActivity);
    const images = await r.context.ensurePdfCountingObjectsLoaded(page);
    assert.equal(images.length, count);
    assert.deepEqual(Array.from(images, image => image.number), Array.from({ length: count }, (_, index) => index + 1));
    assert.equal(new Set(Array.from(images, image => image.image)).size, 1);
    assert.equal(images[0].width, f.manager.getAsset(assetId).contentBounds[2]);
    assert.equal(images[0].height, f.manager.getAsset(assetId).contentBounds[3]);
    if (count === 1) assert.match(page.narrationText, /There is one dog\./);
  }
  assert.deepEqual(r.requestedUrls, ['app://voice/assets/pdf-counting/realistic-v2/dogs.png', 'app://voice/assets/pdf-counting/realistic-v2/stars.png']);
  assert.equal(r.decodedUrls.length, 2, 'One category image is shared across counts and PDFs');
  assert.deepEqual(r.fetchedUrls, []);
  assert.deepEqual(f.writes, [], 'Automatic preparation must not invent persisted user reviews');
});

test('unsupported objects preserve original narration and original rendering until a local image is imported', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  const page = r.page('3 cats');
  assert.equal(page.countingPreparation.status, 'review');
  assert.equal(page.countingPreparation.count, 3);
  assert.equal(page.countingPreparation.noun, 'cats');
  assert.match(page.countingPreparation.reason, /transparent PNG/);
  assert.equal(page.countingActivity, null);
  assert.equal(page.narrationText, '3 cats');
  assert.equal(r.context.shouldRevealPdfCountingObjects(page), false);
  assert.equal(await r.context.ensurePdfCountingObjectsLoaded(page), null);
  assert.deepEqual(r.requestedUrls, []);
});

test('saving one custom image enables matching headings in the current and future PDFs', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  await f.manager.saveAsset(customAsset());
  const current = r.page('3 cats');
  assert.equal(current.countingPreparation.status, 'ready');
  assert.equal(current.countingActivity.objectAssetId, 'custom:cats');
  assertNoSourceAnchors(r.context, current.countingActivity);
  const images = await r.context.ensurePdfCountingObjectsLoaded(current);
  assert.equal(images.length, 3);
  assert.deepEqual(r.requestedUrls, [pngData]);
  assert.equal(r.decodedUrls.length, 1);
  assert.deepEqual(r.fetchedUrls, []);
  const reloaded = f.reload();
  const future = renderer(reloaded).page('1 cat', 'completely-different-pdf', 12);
  assert.equal(future.countingPreparation.status, 'ready');
  assert.equal(future.countingActivity.noun, 'cat');
  assert.equal(future.countingActivity.objectAssetId, 'custom:cats');
  assert.deepEqual(f.writes, [{ type: 'asset', id: 'custom:cats' }]);
});

test('saved manual reviews apply only to their exact PDF fingerprint and page number', async () => {
  const f = await fixture();
  await f.manager.saveReview(countingReview('reviewed-pdf', 7));
  const r = renderer(f.reload());
  const reviewed = r.page('', 'reviewed-pdf', 7);
  assert.equal(reviewed.countingPreparation.status, 'ready');
  assert.equal(reviewed.countingPreparation.reviewed, true);
  assert.equal(reviewed.countingActivity.count, 5);
  assert.equal(reviewed.countingActivity.noun, 'stars');
  assertNoSourceAnchors(r.context, reviewed.countingActivity);
  for (const page of [r.page('', 'other-pdf', 7), r.page('', 'reviewed-pdf', 8)]) {
    assert.equal(page.countingPreparation.status, 'review');
    assert.equal(page.countingActivity, null);
    assert.equal(r.context.shouldRevealPdfCountingObjects(page), false);
  }
});

test('source binding and Original PDF mode prevent a local stage being reused on another page', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  const page = r.page('3 dogs', 'source-a', 4);
  assert.equal(r.context.shouldRevealPdfCountingObjects({ ...page, sourceFingerprint: 'source-b' }), false);
  assert.equal(r.context.shouldRevealPdfCountingObjects({ ...page, pageNumber: 5 }), false);
  assert.equal(r.context.shouldRevealPdfCountingObjects({ ...page, countingActivity: { ...page.countingActivity, objectAssetId: 'missing' } }), false);
  r.state.pdf.countingDisplayMode = 'original';
  assert.equal(r.context.shouldRevealPdfCountingObjects(page), false);
  assert.equal(await r.context.ensurePdfCountingObjectsLoaded(page), null);
  assert.deepEqual(r.requestedUrls, []);
});

test('saved Original choice disables both known nursery activity and unknown automatic activity', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  const knownBefore = r.page('ELEVEN DOGS', knownFingerprint, 26);
  assert.equal(knownBefore.countingActivity.markersVerified, true);
  await f.manager.saveReview(originalReview(knownFingerprint, 26));
  await f.manager.saveReview(originalReview('unknown-pdf', 1));
  for (const page of [r.page('ELEVEN DOGS', knownFingerprint, 26), r.page('3 dogs')]) {
    assert.equal(page.countingPreparation.status, 'original');
    assert.equal(page.countingPreparation.reviewed, true);
    assert.equal(page.countingActivity, null);
    assert.equal(page.narrationText, page.text);
    assert.equal(r.context.shouldRevealPdfCountingObjects(page), false);
  }
  assert.equal(renderer(f.reload()).page('ELEVEN DOGS', knownFingerprint, 26).countingActivity, null);
});

test('explicitly revised known page uses the selected local stage, never obsolete source coordinates', async () => {
  const f = await fixture();
  await f.manager.saveReview(countingReview(knownFingerprint, 26, { count: 4, noun: 'birds', assetId: 'builtin:birds' }));
  const r = renderer(f.manager);
  const page = r.page('ELEVEN DOGS', knownFingerprint, 26);
  assert.equal(page.countingActivity.count, 4);
  assert.equal(page.countingActivity.objectAssetId, 'builtin:birds');
  assert.equal(page.countingActivity.objectSource, 'local-library');
  assertNoSourceAnchors(r.context, page.countingActivity);
  assert.equal((await r.context.ensurePdfCountingObjectsLoaded(page)).length, 4);
  assert.deepEqual(r.fetchedUrls, []);
});

test('alias collisions require review and never silently shadow the bundled image', async () => {
  const f = await fixture();
  await f.manager.saveAsset(customAsset({ id: 'custom:hounds', noun: 'hounds', aliases: ['hounds', 'dogs'] }));
  let result = f.manager.prepare({ text: '3 dogs', fingerprint: 'colliding-pdf', pageNumber: 1 });
  assert.equal(result.status, 'review');
  assert.match(result.reason, /More than one local picture/);
  assert.equal(result.assetId, undefined);
  const r = renderer(f.manager);
  assert.equal(r.page('3 dogs', 'colliding-pdf').countingActivity, null);
  await f.manager.saveReview(countingReview('colliding-pdf', 1, { count: 3, noun: 'dogs', assetId: 'builtin:dogs' }));
  result = f.manager.prepare({ text: '3 dogs', fingerprint: 'colliding-pdf', pageNumber: 1 });
  assert.equal(result.status, 'ready');
  assert.equal(result.assetId, 'builtin:dogs');
});

test('asset and review save failures leave all active in-memory decisions unchanged', async () => {
  const f = await fixture({ failAsset: true, failReview: true });
  await assert.rejects(f.manager.saveAsset(customAsset()), /quota failure/);
  assert.equal(f.manager.getAsset('custom:cats'), undefined);
  assert.equal(f.manager.prepare({ text: '3 cats', fingerprint: 'unknown-pdf', pageNumber: 1 }).status, 'review');
  await assert.rejects(f.manager.saveReview(originalReview()), /disk failure/);
  assert.equal(f.manager.prepare({ text: '3 dogs', fingerprint: 'unknown-pdf', pageNumber: 1 }).status, 'ready');
  await assert.rejects(f.manager.saveReview(countingReview('scanned-pdf', 3)), /disk failure/);
  assert.equal(f.manager.prepare({ text: '', fingerprint: 'scanned-pdf', pageNumber: 3 }).status, 'review');
  assert.deepEqual(f.writes, []);
  assert.equal(f.assets.size, 0);
  assert.equal(f.reviews.size, 0);
});

test('pending persistence is not visible to preparation until the save commits', async () => {
  const assetGate = deferred(), reviewGate = deferred();
  const f = await fixture({ assetGate, reviewGate });
  const saveAsset = f.manager.saveAsset(customAsset());
  assert.equal(f.manager.getAsset('custom:cats'), undefined);
  assetGate.resolve();
  await saveAsset;
  assert.ok(f.manager.getAsset('custom:cats'));
  const saveReview = f.manager.saveReview(originalReview());
  assert.equal(f.manager.prepare({ text: '3 dogs', fingerprint: 'unknown-pdf', pageNumber: 1 }).status, 'ready');
  reviewGate.resolve();
  await saveReview;
  assert.equal(f.manager.prepare({ text: '3 dogs', fingerprint: 'unknown-pdf', pageNumber: 1 }).status, 'original');
});

test('missing reviewed artwork and malformed review IDs cannot create a replacement stage', async () => {
  const f = await fixture();
  await assert.rejects(f.manager.saveReview(countingReview('unknown-pdf', 1, { assetId: 'custom:missing' })), /available local picture/);
  await assert.rejects(f.manager.saveReview(countingReview('unknown-pdf', 1, { id: 'other-pdf:1' })), /does not match/);
  assert.equal(f.reviews.size, 0);
});

test('malformed bundled library data is rejected before preparation can use it', async () => {
  const { validateBuiltinCountingLibrary } = await modulePromise;
  for (const mutate of [
    value => { value.schemaVersion = 2; }, value => { value.assets.pop(); },
    value => { value.assets[0].noun = 'cats'; }, value => { value.assets[0].id = 'custom:dogs'; },
    value => { value.assets[0].src = 'https://external.invalid/dogs.png'; },
    value => { value.assets[0].aliases = ['dog']; }, value => { value.assets[0].aliases = ['dogs', '<script>']; },
    value => { value.assets[0].width = 0; }, value => { value.assets[0].height = 4097; },
    value => { value.assets[0].contentBounds = [-1, 0, 10, 10]; },
    value => { value.assets[0].contentBounds = [0, 0, 9999, 10]; },
    value => { value.assets[0].contentBounds = [0, 0, 10.5, 10]; }
  ]) {
    const catalog = structuredClone(library);
    mutate(catalog);
    assert.throws(() => validateBuiltinCountingLibrary(catalog), /library is (?:invalid|incomplete)/);
  }
  const catalog = structuredClone(library);
  const builtins = validateBuiltinCountingLibrary(catalog);
  catalog.assets[0].aliases.push('cats');
  catalog.assets[0].contentBounds[0] = 0;
  assert.ok(Object.isFrozen(builtins[0]));
  assert.ok(Object.isFrozen(builtins[0].aliases));
  assert.ok(Object.isFrozen(builtins[0].contentBounds));
  assert.ok(!builtins[0].aliases.includes('cats'));
  assert.notEqual(builtins[0].contentBounds[0], 0);
});

test('decoded image dimensions must match the selected reviewed local asset', async () => {
  const f = await fixture();
  const r = renderer(f.manager, { badDimensions: true });
  const page = r.page('3 dogs');
  await assert.rejects(r.context.ensurePdfCountingObjectsLoaded(page), /dimensions do not match/);
  assert.equal(page.countingObjectImages, undefined);
  assert.equal(page.countingObjectPromise, null);
  assert.match(page.countingObjectError, /dimensions/);
});

test('ambiguous or prose content stays original even when a matching picture exists', async () => {
  const f = await fixture();
  const r = renderer(f.manager);
  for (const [text, status] of [['I have three dogs.', 'original'], ['3 dogs\n4 stars', 'review'], ['12 eleven dogs', 'review'], ['', 'review']]) {
    const page = r.page(text);
    assert.equal(page.countingPreparation.status, status, text);
    assert.equal(page.countingActivity, null, text);
    assert.equal(page.narrationText, text);
  }
});

test('superseded picture decode cannot overwrite a newer same-count page setup', async () => {
  const f = await fixture();
  const oldDecodeStarted = deferred(), oldDecode = deferred();
  const r = renderer(f.manager, { onDecode: async url => {
    if (url.endsWith('/dogs.png')) {
      oldDecodeStarted.resolve();
      await oldDecode.promise;
    }
  } });
  const page = r.page('3 dogs');
  const firstActivity = page.countingActivity;
  const loadingOld = r.context.ensurePdfCountingObjectsLoaded(page);
  const oldRejection = assert.rejects(loadingOld, error => error.name === 'AbortError');
  await oldDecodeStarted.promise;
  assert.equal(page.countingObjectImages, undefined);
  Object.assign(page, r.context.buildPdfCountingSetup('3 stars', [], page.sourceFingerprint, page.pageNumber), {
    text: '3 stars', countingObjectPromise: null, countingObjectImages: null, countingObjectError: ''
  });
  assert.notEqual(page.countingActivity, firstActivity);
  assert.equal(page.countingActivity.count, firstActivity.count, 'Count alone cannot identify an artwork request');
  const currentImages = await r.context.ensurePdfCountingObjectsLoaded(page);
  const currentPromise = page.countingObjectPromise;
  const currentRevision = page.countingObjectRevision;
  assert.ok(currentImages.every(object => object.image.url.endsWith('/stars.png')));
  oldDecode.resolve();
  await oldRejection;
  assert.equal(page.countingObjectImages, currentImages);
  assert.equal(page.countingObjectPromise, currentPromise);
  assert.equal(page.countingObjectRevision, currentRevision);
  assert.equal(page.countingObjectError, '');
  assert.equal(await r.context.ensurePdfCountingObjectsLoaded(page), currentImages);
  assert.equal(r.requestedUrls.length, 2);
});

test('superseded picture failure cannot set the current error or clear its successful promise', async () => {
  const f = await fixture();
  const oldDecodeStarted = deferred(), oldDecode = deferred();
  const r = renderer(f.manager, { onDecode: async url => {
    if (url.endsWith('/dogs.png')) {
      oldDecodeStarted.resolve();
      await oldDecode.promise;
    }
  } });
  const page = r.page('3 dogs');
  const loadingOld = r.context.ensurePdfCountingObjectsLoaded(page);
  const oldRejection = assert.rejects(loadingOld, /Synthetic obsolete picture decode failure/);
  await oldDecodeStarted.promise;
  Object.assign(page, r.context.buildPdfCountingSetup('3 stars', [], page.sourceFingerprint, page.pageNumber), {
    text: '3 stars', countingObjectPromise: null, countingObjectImages: null, countingObjectError: ''
  });
  const currentImages = await r.context.ensurePdfCountingObjectsLoaded(page);
  const currentPromise = page.countingObjectPromise;
  assert.ok(currentPromise);
  oldDecode.reject(new Error('Synthetic obsolete picture decode failure'));
  await oldRejection;
  assert.equal(page.countingObjectImages, currentImages);
  assert.equal(page.countingObjectPromise, currentPromise);
  assert.equal(page.countingObjectError, '');
  assert.ok(page.countingObjectImages.every(object => object.image.url.endsWith('/stars.png')));
  assert.equal(await r.context.ensurePdfCountingObjectsLoaded(page), currentImages);
});

test('saved assets retain normalized aliases and defensive ownership across the persistence await', async () => {
  const assetGate = deferred();
  const f = await fixture({ assetGate });
  const input = customAsset({ noun: ' Cats ', aliases: [' CATS ', 'cat', 'toy  cats'] });
  const saving = f.manager.saveAsset(input);
  input.id = 'custom:changed';
  input.noun = 'changed';
  input.aliases.splice(0, input.aliases.length, 'changed');
  input.contentBounds[0] = 80;
  input.src = 'https://external.invalid/changed.png';
  assetGate.resolve();
  await saving;
  const saved = f.manager.getAsset('custom:cats');
  assert.ok(saved);
  assert.equal(saved.noun, 'Cats');
  assert.deepEqual(saved.aliases, ['cats', 'cat', 'toy cats']);
  assert.deepEqual(saved.contentBounds, [2, 3, 92, 59]);
  assert.equal(saved.src, pngData);
  assert.equal(f.manager.getAsset('custom:changed'), undefined);
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(saved.aliases));
  assert.ok(Object.isFrozen(saved.contentBounds));
  input.aliases.push('dogs');
  input.contentBounds[1] = 60;
  assert.ok(!saved.aliases.includes('dogs'));
  assert.deepEqual(saved.contentBounds, [2, 3, 92, 59]);
  assert.equal(f.manager.prepare({ text: '3 cats', fingerprint: 'future-pdf', pageNumber: 1 }).status, 'ready');
  assert.deepEqual(f.reload().getAsset('custom:cats').aliases, saved.aliases);
});

test('saved reviews and initial stored records do not retain mutable caller ownership', async () => {
  const reviewGate = deferred();
  const f = await fixture({ reviewGate });
  const input = countingReview('reviewed-pdf', 7, { noun: ' Stars ' });
  const saving = f.manager.saveReview(input);
  input.id = 'other-pdf:8';
  input.fingerprint = 'other-pdf';
  input.pageNumber = 8;
  input.count = 20;
  input.noun = 'dogs';
  input.assetId = 'builtin:dogs';
  reviewGate.resolve();
  await saving;
  input.mode = 'original';
  const saved = f.manager.prepare({ text: '', fingerprint: 'reviewed-pdf', pageNumber: 7 });
  assert.equal(saved.status, 'ready');
  assert.equal(saved.count, 5);
  assert.equal(saved.noun, 'stars');
  assert.equal(saved.assetId, 'builtin:stars');
  assert.equal(f.manager.prepare({ text: '', fingerprint: 'other-pdf', pageNumber: 8 }).status, 'review');
  const { createPdfCountingPreparation } = await modulePromise;
  const initialAsset = customAsset(), initialReview = countingReview('restored-pdf', 2);
  const restored = createPdfCountingPreparation({ builtins: f.builtins, assets: [initialAsset], reviews: [initialReview] });
  initialAsset.aliases.push('dogs');
  initialAsset.contentBounds[0] = 90;
  initialReview.count = 19;
  initialReview.mode = 'original';
  assert.deepEqual(restored.getAsset('custom:cats').aliases, ['cats', 'cat']);
  assert.deepEqual(restored.getAsset('custom:cats').contentBounds, [2, 3, 92, 59]);
  assert.equal(restored.prepare({ text: '', fingerprint: 'restored-pdf', pageNumber: 2 }).count, 5);
});
