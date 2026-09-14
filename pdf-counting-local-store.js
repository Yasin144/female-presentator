// Local-only persistence for explicitly supplied counting pictures and reviewed
// PDF decisions. This module never fetches URLs, starts services, or guesses
// counts, nouns, aliases, or a suitable picture.
export const PDF_COUNTING_LOCAL_DATABASE = "presentator-pdf-counting-v1";
export const PDF_COUNTING_LOCAL_MAX_DATA_URL_LENGTH = 8 * 1024 * 1024;

const STORE_NAMES = ["assets", "reviews"];
const NOUN_PATTERN = /^[A-Za-z]+(?:[ -][A-Za-z]+)*$/;
const CUSTOM_ID_PATTERN = /^custom:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ASSET_ID_PATTERN = /^[a-z][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/;
const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain record.`);
  }
  return value;
}

function requireSafeString(value, label, pattern, maximum) {
  if (typeof value !== "string" || !value.length || value.length > maximum || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid.`);
  }
  return value;
}

export function normalizePdfCountingLocalNoun(value) {
  if (typeof value !== "string" || value.length > 160) throw new TypeError("Counting noun must be short text.");
  // Only trim/collapse ordinary spaces. Tabs, newlines, markup, punctuation,
  // controls and numeric guesses are not accepted as object names.
  const noun = value.replace(/^ +| +$/g, "").replace(/ +/g, " ");
  return requireSafeString(noun, "Counting noun", NOUN_PATTERN, 40).toLowerCase();
}

function displayNoun(value) {
  normalizePdfCountingLocalNoun(value);
  return value.replace(/^ +| +$/g, "").replace(/ +/g, " ");
}

function requireDimension(value, label) {
  if (!Number.isInteger(value) || value < 32 || value > 4096) {
    throw new TypeError(`${label} must be an integer from 32 to 4096.`);
  }
  return value;
}

function requirePngDataUrl(value) {
  const prefix = "data:image/png;base64,";
  if (typeof value !== "string" || value.length > PDF_COUNTING_LOCAL_MAX_DATA_URL_LENGTH
      || !value.startsWith(prefix)) {
    throw new TypeError("Counting picture must be a local PNG data URL of at most 8 MiB.");
  }
  const encoded = value.slice(prefix.length);
  // A PNG signature is not a substitute for decoding the image. The caller
  // checks decoded dimensions and real nontransparent content before saving.
  if (encoded.length < 44 || encoded.length % 4 !== 0 || !encoded.startsWith("iVBORw0KGgo")
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new TypeError("Counting picture has invalid PNG/base64 data.");
  }
  return value;
}

export function validatePdfCountingLocalAsset(value) {
  const asset = requireRecord(value, "Counting asset");
  const id = requireSafeString(asset.id, "Custom counting asset ID", CUSTOM_ID_PATTERN, 80);
  const noun = displayNoun(asset.noun);
  if (!Array.isArray(asset.aliases) || !asset.aliases.length || asset.aliases.length > 12) {
    throw new TypeError("Counting asset requires 1 to 12 explicit noun aliases.");
  }
  const aliases = [...new Set(asset.aliases.map(normalizePdfCountingLocalNoun))];
  if (!aliases.includes(normalizePdfCountingLocalNoun(noun))) {
    throw new TypeError("Counting aliases must include the asset's noun.");
  }
  const src = requirePngDataUrl(asset.src);
  const width = requireDimension(asset.width, "Counting picture width");
  const height = requireDimension(asset.height, "Counting picture height");
  const bounds = asset.contentBounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
      || bounds[0] < 0 || bounds[1] < 0 || bounds[2] <= 0 || bounds[3] <= 0
      || bounds[0] + bounds[2] > width || bounds[1] + bounds[3] > height) {
    throw new TypeError("Counting picture content bounds must be inside the image.");
  }
  // Return only known, validated fields and fresh arrays, not caller-owned
  // objects or unexpected properties that could become executable UI data.
  return { id, noun, aliases, src, width, height, contentBounds: bounds.slice() };
}

export function validatePdfCountingPageReview(value) {
  const review = requireRecord(value, "PDF counting review");
  const fingerprint = requireSafeString(review.fingerprint, "PDF fingerprint", FINGERPRINT_PATTERN, 160);
  if (!Number.isSafeInteger(review.pageNumber) || review.pageNumber < 1 || review.pageNumber > 1000000) {
    throw new TypeError("Reviewed PDF page number must be a positive integer.");
  }
  const pageNumber = review.pageNumber;
  const id = `${fingerprint}:${pageNumber}`;
  if (review.id !== id) throw new TypeError("PDF review ID does not match its document and page.");
  if (review.mode === "original") return { id, fingerprint, pageNumber, mode: "original" };
  if (review.mode !== "counting") throw new TypeError("PDF review mode must be original or counting.");
  if (!Number.isInteger(review.count) || review.count < 1 || review.count > 20) {
    throw new TypeError("Reviewed object count must be an integer from 1 to 20.");
  }
  const noun = displayNoun(review.noun);
  const assetId = requireSafeString(review.assetId, "Reviewed counting asset ID", ASSET_ID_PATTERN, 96);
  return { id, fingerprint, pageNumber, mode: "counting", count: review.count, noun, assetId };
}

function storageError(error, fallback) {
  return error instanceof Error ? error : new Error(fallback);
}

function openLocalDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB || typeof globalThis.indexedDB.open !== "function") {
      reject(new Error("Local counting storage is unavailable in this browser."));
      return;
    }
    let request;
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      reject(storageError(error, "Could not open local counting storage."));
    };
    try {
      request = globalThis.indexedDB.open(PDF_COUNTING_LOCAL_DATABASE, 1);
    } catch (error) {
      fail(error);
      return;
    }
    request.onupgradeneeded = () => {
      if (settled) {
        try { request.transaction?.abort(); } catch { /* Already aborted. */ }
        return;
      }
      try {
        const database = request.result;
        for (const name of STORE_NAMES) {
          if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: "id" });
        }
      } catch (error) {
        try { request.transaction?.abort(); } catch { /* Preserve original failure. */ }
        fail(error);
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error("Local counting storage is blocked by another open app window. Close that window and retry."));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      if (!STORE_NAMES.every(name => database.objectStoreNames.contains(name))) {
        database.close();
        fail(new Error("Local counting storage has an invalid schema."));
        return;
      }
      database.onversionchange = () => database.close();
      settled = true;
      resolve(database);
    };
  });
}

async function localTransaction(names, mode, operation) {
  const database = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    let transaction;
    let settled = false;
    let completedResult;
    let ready = false;
    const close = () => { try { database.close(); } catch { /* Already closed. */ } };
    const fail = error => {
      if (settled) return;
      settled = true;
      try { transaction?.abort(); } catch { /* It may already have aborted. */ }
      close();
      reject(storageError(error, "Local counting storage transaction failed."));
    };
    const finish = value => { completedResult = value; ready = true; };
    try {
      transaction = database.transaction(names, mode);
      transaction.onabort = () => fail(transaction.error || new Error("Local counting storage transaction was aborted."));
      transaction.onerror = event => fail(event?.target?.error || transaction.error);
      transaction.oncomplete = () => {
        if (settled) return;
        if (!ready) {
          fail(new Error("Local counting storage completed without a validated result."));
          return;
        }
        settled = true;
        close();
        resolve(completedResult);
      };
      operation(transaction, finish, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export async function readPdfCountingLocalState() {
  return localTransaction(STORE_NAMES, "readonly", (transaction, finish, fail) => {
    const result = { assets: [], reviews: [] };
    let pending = STORE_NAMES.length;
    for (const name of STORE_NAMES) {
      const request = transaction.objectStore(name).getAll();
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        try {
          if (!Array.isArray(request.result)) throw new TypeError(`Local counting ${name} are malformed.`);
          const validate = name === "assets" ? validatePdfCountingLocalAsset : validatePdfCountingPageReview;
          result[name] = request.result.map(validate);
          const ids = new Set(result[name].map(record => record.id));
          if (ids.size !== result[name].length) throw new TypeError(`Local counting ${name} contain duplicate IDs.`);
          pending -= 1;
          if (!pending) finish(result);
        } catch (error) {
          fail(error);
        }
      };
    }
  });
}

function saveLocalRecord(store, record) {
  return localTransaction([store], "readwrite", (transaction, finish, fail) => {
    const request = transaction.objectStore(store).put(record);
    request.onerror = () => fail(request.error);
    // A successful request can still be rolled back (quota/disk/abort). Only
    // the transaction's oncomplete handler is allowed to resolve the promise.
    request.onsuccess = () => finish(record);
  });
}

export async function savePdfCountingLocalAsset(asset) {
  return saveLocalRecord("assets", validatePdfCountingLocalAsset(asset));
}

export async function savePdfCountingPageReview(review) {
  return saveLocalRecord("reviews", validatePdfCountingPageReview(review));
}
