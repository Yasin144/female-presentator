import { analyzePdfCountingPage } from './pdf-counting-auto.js';
import { readPdfCountingLocalState, savePdfCountingLocalAsset, savePdfCountingPageReview, validatePdfCountingLocalAsset, validatePdfCountingPageReview } from './pdf-counting-local-store.js';

const SAFE_NOUN = /^[a-z]+(?:[ -][a-z]+)*$/;
const normalize = value => String(value || '').toLowerCase().trim().replace(/\s+/g, ' ');

export function validateBuiltinCountingLibrary(catalog) {
  const nouns = ['dogs', 'books', 'candies', 'birds', 'bananas', 'butterflies', 'gifts', 'ants', 'leaves', 'stars'];
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.assets) || catalog.assets.length !== nouns.length) throw new Error('Local counting picture library is incomplete.');
  return catalog.assets.map((asset, index) => {
    const bounds = asset?.contentBounds;
    if (asset?.noun !== nouns[index] || asset.id !== `builtin:${asset.noun}`
        || asset.src !== `assets/pdf-counting/realistic-v2/${asset.noun}.png`
        || !Array.isArray(asset.aliases) || !asset.aliases.includes(asset.noun) || !asset.aliases.every(noun => SAFE_NOUN.test(noun))
        || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width < 32 || asset.height < 32 || asset.width > 4096 || asset.height > 4096
        || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isInteger)
        || bounds[0] < 0 || bounds[1] < 0 || bounds[2] <= 0 || bounds[3] <= 0
        || bounds[0] + bounds[2] > asset.width || bounds[1] + bounds[3] > asset.height) throw new Error('Local counting picture library is invalid.');
    return Object.freeze({ ...asset, aliases: Object.freeze([...asset.aliases]), contentBounds: Object.freeze([...bounds]) });
  });
}

export function createPdfCountingPreparation({ builtins, assets = [], reviews = [], storageWarning = '', persistAsset = savePdfCountingLocalAsset, persistReview = savePdfCountingPageReview }) {
  const freezePicture = asset => Object.freeze({ ...asset, aliases: Object.freeze([...asset.aliases]), contentBounds: Object.freeze([...asset.contentBounds]) });
  const pictures = new Map([...builtins, ...assets.map(validatePdfCountingLocalAsset)].map(asset => [asset.id, freezePicture(asset)]));
  const decisions = new Map(reviews.map(value => { const review = Object.freeze(validatePdfCountingPageReview(value)); return [review.id, review]; }));
  return {
    storageWarning,
    listAssets: () => Array.from(pictures.values()),
    getAsset: id => pictures.get(id),
    prepare({ text, items = [], fingerprint, pageNumber }) {
      const analysis = analyzePdfCountingPage({ text, items });
      const review = decisions.get(`${fingerprint}:${pageNumber}`);
      if (review?.mode === 'original') return { status: 'original', reason: 'Original page retained by your saved choice.', analysis, reviewed: true };
      const candidate = review?.mode === 'counting' ? review : analysis.status === 'ready' ? analysis : null;
      if (!candidate) return { status: analysis.status === 'none' ? 'original' : 'review', reason: analysis.reason, analysis };
      const noun = normalize(candidate.noun);
      const matches = Array.from(pictures.values()).filter(asset => asset.aliases.includes(noun));
      // A user-added alias cannot silently shadow another picture.
      const asset = review ? pictures.get(review.assetId) : matches.length === 1 ? matches[0] : null;
      if (!asset) return { status: 'review', reason: matches.length > 1 ? `More than one local picture matches ${noun}. Choose one below.` : `Add a complete transparent PNG for ${noun} to the local library.`, analysis, count: candidate.count, noun };
      return { status: 'ready', reason: review ? 'Your saved counting setup is ready.' : 'Clear heading matched a local picture automatically.', analysis, count: candidate.count, noun, assetId: asset.id, reviewed: Boolean(review) };
    },
    async saveAsset(asset) {
      const record = validatePdfCountingLocalAsset(asset);
      await persistAsset(record);
      pictures.set(record.id, freezePicture(record));
    },
    async saveReview(review) {
      const record = validatePdfCountingPageReview(review);
      if (record.mode === 'counting' && !pictures.has(record.assetId)) throw new Error('Choose an available local picture first.');
      await persistReview(record);
      decisions.set(record.id, Object.freeze(record));
    }
  };
}

export async function loadPdfCountingPreparation() {
  const response = await fetch(new URL('./assets/pdf-counting/library.json', import.meta.url));
  if (!response.ok) throw new Error('Local counting picture library could not be loaded.');
  const builtins = validateBuiltinCountingLibrary(await response.json());
  let localState = { assets: [], reviews: [] }, storageWarning = '';
  try { localState = await readPdfCountingLocalState(); }
  catch (error) { storageWarning = `Saved local pictures or reviews could not be loaded: ${error.message}. Existing pages are unchanged.`; }
  return createPdfCountingPreparation({ builtins, ...localState, storageWarning });
}
