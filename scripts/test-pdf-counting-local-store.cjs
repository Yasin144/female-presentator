const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const modulePromise = import(pathToFileURL(path.join(__dirname, "..", "pdf-counting-local-store.js")).href);
// Signature/header-only test payload: this module validates safe local storage;
// actual image decoding and alpha checks intentionally belong to the uploader.
const pngData = "data:image/png;base64," + Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(48)
]).toString("base64");
const asset = overrides => ({
  id: "custom:toy-cars", noun: "Toy Cars", aliases: ["toy cars", "toy car"],
  src: pngData, width: 96, height: 64, contentBounds: [2, 3, 92, 59], ...overrides
});
const review = overrides => ({
  id: "pdf_123:7", fingerprint: "pdf_123", pageNumber: 7,
  mode: "counting", count: 4, noun: "Toy Cars", assetId: "custom:toy-cars", ...overrides
});
const tick = () => new Promise(resolve => setImmediate(resolve));

// Minimal asynchronous IndexedDB event double. It deliberately separates
// request success from transaction commit so tests can catch premature saves.
function fakeIndexedDB(settings = {}) {
  const stores = new Map();
  const transactions = [], opens = [], closed = [];
  let upgraded = false;
  let latestRequest;
  const indexedDB = {
    open(name, version) {
      opens.push({ name, version });
      if (settings.throwOpen) throw new Error("open threw");
      const request = {};
      latestRequest = request;
      queueMicrotask(() => {
        if (settings.openError) { request.error = new Error("open failed"); request.onerror?.(); return; }
        if (settings.blocked) { request.onblocked?.(); return; }
        const database = {
          objectStoreNames: { contains: name => stores.has(name) },
          createObjectStore(name, options) {
            assert.equal(options.keyPath, "id");
            stores.set(name, new Map());
            return {};
          },
          close() { closed.push(database); },
          transaction(names, mode) {
            if (settings.throwTransaction) throw new Error("transaction threw");
            const staged = [];
            const transaction = {
              names, mode, pending: 0, aborted: false, done: false, abortCalls: 0,
              abort() {
                this.abortCalls += 1;
                if (this.done || this.aborted) throw new Error("already inactive");
                this.aborted = true;
                queueMicrotask(() => this.onabort?.());
              },
              complete() {
                if (this.done || this.aborted) return;
                if (settings.abortAfterRequest) { this.error = new Error("quota failure after request success"); this.abort(); return; }
                for (const [storeName, record] of staged) stores.get(storeName).set(record.id, structuredClone(record));
                this.done = true;
                this.oncomplete?.();
              },
              objectStore(storeName) {
                assert.ok(names.includes(storeName));
                const makeRequest = (method, record) => {
                  const operation = {};
                  this.pending += 1;
                  queueMicrotask(() => {
                    if (this.aborted) return;
                    if (settings.requestError) {
                      operation.error = new Error("request failed");
                      operation.onerror?.();
                      if (!this.aborted) this.onerror?.({ target: operation });
                      return;
                    }
                    if (method === "put") {
                      staged.push([storeName, structuredClone(record)]);
                      operation.result = record.id;
                    } else {
                      operation.result = settings.readOverride?.(storeName)
                        ?? [...stores.get(storeName).values()].map(value => structuredClone(value));
                    }
                    operation.onsuccess?.();
                    this.pending -= 1;
                    if (!this.pending && !settings.holdCompletion) queueMicrotask(() => this.complete());
                  });
                  return operation;
                };
                return { getAll: () => makeRequest("getAll"), put: record => makeRequest("put", record) };
              }
            };
            transactions.push(transaction);
            return transaction;
          }
        };
        request.result = database;
        request.transaction = { abort() { request.error = new Error("upgrade aborted"); } };
        if (!upgraded) {
          upgraded = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    }
  };
  return { indexedDB, stores, transactions, opens, closed, get latestRequest() { return latestRequest; } };
}

async function withFake(settings, body) {
  const previous = globalThis.indexedDB;
  const fake = fakeIndexedDB(settings);
  globalThis.indexedDB = fake.indexedDB;
  try { return await body(fake, await modulePromise); }
  finally {
    if (previous === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previous;
  }
}

test("asset validation canonicalizes explicit aliases, copies arrays and drops unknown fields", async () => {
  const api = await modulePromise;
  const value = asset({ noun: "  Toy  Cars ", aliases: [" Toy Cars ", "TOY CAR", "toy cars"], onclick: "bad" });
  const result = api.validatePdfCountingLocalAsset(value);
  assert.equal(result.noun, "Toy Cars");
  assert.deepEqual(result.aliases, ["toy cars", "toy car"]);
  assert.equal(result.onclick, undefined);
  value.contentBounds[0] = 80;
  value.aliases[0] = "changed";
  assert.deepEqual(result.contentBounds, [2, 3, 92, 59]);
  assert.deepEqual(result.aliases, ["toy cars", "toy car"]);
});

test("assets reject unsafe names, IDs, URLs, dimensions, bounds and guessed/missing aliases", async () => {
  const api = await modulePromise;
  const invalid = [
    null, [], Object.create({ id: "inherited" }),
    asset({ id: "custom:Toy-Cars" }), asset({ id: "custom:../dogs" }), asset({ id: "custom:a--b" }),
    asset({ noun: "<img>" }), asset({ noun: "dog\ncat" }), asset({ noun: "\tdogs" }), asset({ noun: "a".repeat(41) }),
    asset({ aliases: [] }), asset({ aliases: ["truck"] }), asset({ aliases: ["toy cars", "<script>"] }),
    asset({ src: "https://example.invalid/a.png" }), asset({ src: "data:image/svg+xml;base64,PHN2Zz4=" }),
    asset({ src: "data:image/png;base64,YmFkYmFkYmFk" }), asset({ src: pngData + "\n" }),
    asset({ width: 31 }), asset({ width: 4097 }), asset({ height: 64.5 }),
    asset({ contentBounds: [-1, 0, 90, 60] }), asset({ contentBounds: [0, 0, 97, 64] }),
    asset({ contentBounds: [0, 0, 0, 64] }), asset({ contentBounds: [0, 0, 90, Infinity] }),
    asset({ contentBounds: [0, 0, 90] })
  ];
  invalid.forEach((value, index) => assert.throws(() => api.validatePdfCountingLocalAsset(value), TypeError, `Invalid asset ${index}`));
});

test("data URLs enforce the 8 MiB string limit before expensive validation", async () => {
  const api = await modulePromise;
  assert.throws(() => api.validatePdfCountingLocalAsset(asset({ src: pngData + "A".repeat(api.PDF_COUNTING_LOCAL_MAX_DATA_URL_LENGTH) })), /at most 8 MiB/);
  const base = "data:image/png;base64,iVBORw0KGgo";
  const size = 4 * 1024 * 1024;
  const data = base + "A".repeat(size - (base.length - "data:image/png;base64,".length));
  assert.equal(api.validatePdfCountingLocalAsset(asset({ src: data })).src.length, data.length);
});

test("reviews keep document/page decisions explicit and original mode has no invented counting fields", async () => {
  const api = await modulePromise;
  assert.deepEqual(api.validatePdfCountingPageReview(review({ count: 1 })), review({ count: 1 }));
  assert.equal(api.validatePdfCountingPageReview(review({ count: 20, assetId: "builtin:dogs" })).count, 20);
  assert.deepEqual(api.validatePdfCountingPageReview(review({ mode: "original" })), {
    id: "pdf_123:7", fingerprint: "pdf_123", pageNumber: 7, mode: "original"
  });
  for (const bad of [
    review({ id: "another:7" }), review({ fingerprint: "../pdf" }), review({ fingerprint: "" }),
    review({ id: "pdf_123:0", pageNumber: 0 }), review({ pageNumber: 1.5 }), review({ mode: "auto" }),
    review({ count: 0 }), review({ count: 21 }), review({ count: "12" }), review({ count: undefined }),
    review({ noun: undefined }), review({ noun: "dogs<script>" }), review({ assetId: undefined }),
    review({ assetId: "https://example.invalid/p.png" }), review({ assetId: "a".repeat(97) })
  ]) assert.throws(() => api.validatePdfCountingPageReview(bad), TypeError);
});

test("a new local database has both keyed stores and round-trips assets and page decisions", async () => {
  await withFake({}, async (fake, api) => {
    assert.deepEqual(await api.readPdfCountingLocalState(), { assets: [], reviews: [] });
    assert.deepEqual(fake.opens[0], { name: "presentator-pdf-counting-v1", version: 1 });
    assert.deepEqual([...fake.stores.keys()], ["assets", "reviews"]);
    await api.savePdfCountingLocalAsset(asset());
    await api.savePdfCountingPageReview(review());
    const saved = await api.readPdfCountingLocalState();
    assert.deepEqual(saved, { assets: [asset()], reviews: [review()] });
    await api.savePdfCountingPageReview(review({ mode: "original" }));
    const changed = await api.readPdfCountingLocalState();
    assert.equal(changed.reviews.length, 1);
    assert.equal(changed.reviews[0].mode, "original");
    assert.equal(changed.reviews[0].count, undefined);
    assert.equal(fake.closed.length, fake.opens.length);
  });
});

test("writes and reads remain pending after request success until transaction completion", async () => {
  await withFake({ holdCompletion: true }, async (fake, api) => {
    let resolved = false;
    const saving = api.savePdfCountingLocalAsset(asset()).then(value => { resolved = true; return value; });
    await tick();
    assert.equal(resolved, false);
    assert.equal(fake.stores.get("assets").size, 0);
    fake.transactions[0].complete();
    assert.deepEqual(await saving, asset());
    let readDone = false;
    const reading = api.readPdfCountingLocalState().then(value => { readDone = true; return value; });
    await tick();
    assert.equal(readDone, false);
    fake.transactions[1].complete();
    assert.equal((await reading).assets.length, 1);
  });
});

test("a quota/abort after a successful write request rejects and never claims a durable save", async () => {
  await withFake({ abortAfterRequest: true }, async (fake, api) => {
    await assert.rejects(api.savePdfCountingLocalAsset(asset()), /quota failure/);
    assert.equal(fake.stores.get("assets").size, 0);
    assert.ok(fake.transactions[0].aborted);
    assert.equal(fake.closed.length, 1);
  });
});

test("request errors abort their transaction and close the database", async () => {
  await withFake({ requestError: true }, async (fake, api) => {
    await assert.rejects(api.savePdfCountingPageReview(review()), /request failed/);
    assert.ok(fake.transactions[0].aborted);
    assert.equal(fake.stores.get("reviews").size, 0);
    assert.equal(fake.closed.length, 1);
    await assert.rejects(api.readPdfCountingLocalState(), /request failed/);
  });
});

test("corrupt stored records or malformed read responses reject rather than silently disappearing", async () => {
  for (const data of [[asset({ src: "https://example.invalid/a.png" })], [asset(), asset()], { not: "an array" }]) {
    await withFake({ readOverride: name => name === "assets" ? data : [] }, async (fake, api) => {
      await assert.rejects(api.readPdfCountingLocalState(), /PNG|duplicate|malformed/);
      assert.ok(fake.transactions[0].aborted);
    });
  }
  await withFake({ readOverride: name => name === "reviews" ? [review({ count: 99 })] : [] }, async (_, api) => {
    await assert.rejects(api.readPdfCountingLocalState(), /1 to 20/);
  });
});

test("unavailable, failed, throwing and blocked opens all reject", async () => {
  const api = await modulePromise;
  const previous = globalThis.indexedDB;
  delete globalThis.indexedDB;
  try { await assert.rejects(api.readPdfCountingLocalState(), /unavailable/); }
  finally { if (previous !== undefined) globalThis.indexedDB = previous; }
  for (const [settings, expression] of [
    [{ openError: true }, /open failed/], [{ throwOpen: true }, /open threw/],
    [{ blocked: true }, /blocked/], [{ throwTransaction: true }, /transaction threw/]
  ]) await withFake(settings, async (_, api) => assert.rejects(api.readPdfCountingLocalState(), expression));
});

test("a blocked open that succeeds later closes its unused connection", async () => {
  await withFake({ blocked: true }, async (fake, api) => {
    await assert.rejects(api.readPdfCountingLocalState(), /blocked/);
    let closed = false;
    fake.latestRequest.result = { close() { closed = true; } };
    fake.latestRequest.onsuccess();
    assert.equal(closed, true);
  });
});

test("invalid writes reject before opening IndexedDB", async () => {
  await withFake({}, async (fake, api) => {
    await assert.rejects(api.savePdfCountingLocalAsset(asset({ src: "https://example.invalid" })), TypeError);
    await assert.rejects(api.savePdfCountingPageReview(review({ count: 99 })), TypeError);
    assert.equal(fake.opens.length, 0);
  });
});
