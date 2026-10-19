// Expense Memory — Core Personal Finance Intelligence, Parser, Reconciliation & Analytics Engine
// Pure ES module (zero DOM dependencies) so it runs identically in React, Android WebView, and Node.js tests.

export const EXPENSE_CATEGORIES = [
  { id: 'food', label: 'Food & Dining', icon: '🍽️', color: '#ea580c', bg: 'rgba(234, 88, 12, 0.14)', subcategories: ['Tea & Snacks', 'Lunch & Dinner', 'Delivery', 'Cafe & Bakery'] },
  { id: 'groceries', label: 'Groceries & Daily Needs', icon: '🛒', color: '#059669', bg: 'rgba(5, 150, 105, 0.14)', subcategories: ['Vegetables & Fruit', 'Milk & Dairy', 'Supermarket', 'Household'] },
  { id: 'fuel', label: 'Fuel & Travel', icon: '⛽', color: '#0284c7', bg: 'rgba(2, 132, 199, 0.14)', subcategories: ['Petrol / Diesel', 'Auto & Cab', 'Train & Bus', 'Toll & Parking'] },
  { id: 'shopping', label: 'Shopping', icon: '🛍️', color: '#db2777', bg: 'rgba(219, 39, 119, 0.14)', subcategories: ['Clothing', 'Electronics', 'Home & Kitchen', 'Online Order'] },
  { id: 'bills', label: 'Bills & Utilities', icon: '⚡', color: '#d97706', bg: 'rgba(217, 119, 6, 0.14)', subcategories: ['Mobile Recharge', 'Electricity & Water', 'Internet / Wi-Fi', 'Rent & EMI'] },
  { id: 'family', label: 'Family & Personal', icon: '👨‍👩‍👧', color: '#7c3aed', bg: 'rgba(124, 58, 237, 0.14)', subcategories: ['Sent to Family', 'Kids & Education', 'Gifts', 'Personal Care'] },
  { id: 'medical', label: 'Health & Medical', icon: '🏥', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.14)', subcategories: ['Pharmacy', 'Doctor / Clinic', 'Lab Test', 'Fitness'] },
  { id: 'work', label: 'Work & Office', icon: '💼', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.14)', subcategories: ['Office Supplies', 'Client / Team', 'Business Travel', 'Software'] },
  { id: 'entertainment', label: 'Movies & Leisure', icon: '🎬', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.14)', subcategories: ['Movies', 'Subscriptions', 'Games', 'Outing'] },
  { id: 'cash', label: 'ATM / Cash', icon: '💵', color: '#0d9488', bg: 'rgba(13, 148, 136, 0.14)', subcategories: ['ATM Withdrawal', 'Cash Spend'] },
  { id: 'transfer', label: 'UPI / Self Transfer', icon: '🔄', color: '#4f46e5', bg: 'rgba(79, 70, 229, 0.14)', subcategories: ['Friend / Contact', 'Self Account Transfer'] },
  { id: 'refund', label: 'Refund / Reversal', icon: '↩️', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)', subcategories: ['Merchant Refund', 'UPI Reversal', 'Cashback'] },
  { id: 'income', label: 'Received / Income', icon: '💰', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.14)', subcategories: ['Salary', 'Payment Received', 'Family / Friend'] },
];

export const PAYMENT_APPS = [
  { id: 'GPay', label: 'Google Pay (GPay)', method: 'UPI', color: '#38bdf8' },
  { id: 'PhonePe', label: 'PhonePe', method: 'UPI', color: '#a855f7' },
  { id: 'Paytm', label: 'Paytm', method: 'UPI', color: '#0ea5e9' },
  { id: 'BHIM UPI', label: 'BHIM UPI', method: 'UPI', color: '#f97316' },
  { id: 'Bank SMS', label: 'Bank Account / SMS', method: 'Bank Account', color: '#eab308' },
  { id: 'Cash', label: 'Cash', method: 'Cash', color: '#10b981' },
  { id: 'Card', label: 'Debit / Credit Card', method: 'Card', color: '#ec4899' },
];

export const DEFAULT_TAGS = [
  'Food',
  'Travel',
  'Family',
  'Shopping',
  'Bills',
  'Work',
  'Personal',
];

export const QUICK_NOTE_CHIPS = [
  { label: '☕ Tea & Snacks', note: 'Tea & Snacks', category: 'food', tag: 'Food' },
  { label: '🍱 Lunch / Dinner', note: 'Lunch / Dinner', category: 'food', tag: 'Food' },
  { label: '🛒 Groceries & Milk', note: 'Groceries & Milk', category: 'groceries', tag: 'Food' },
  { label: '⛽ Petrol / Fuel', note: 'Petrol / Fuel', category: 'fuel', tag: 'Travel' },
  { label: '🛺 Auto / Cab Travel', note: 'Auto / Cab Travel', category: 'fuel', tag: 'Travel' },
  { label: '👨‍👩‍👧 Sent to Family', note: 'Sent to Family', category: 'family', tag: 'Family' },
  { label: '🛍️ Shopping', note: 'Shopping', category: 'shopping', tag: 'Shopping' },
  { label: '📱 Mobile Recharge', note: 'Mobile Recharge', category: 'bills', tag: 'Bills' },
  { label: '🏠 Rent / Utility Bill', note: 'Rent / Utility Bill', category: 'bills', tag: 'Bills' },
  { label: '💊 Medicine / Pharmacy', note: 'Medicine / Pharmacy', category: 'medical', tag: 'Personal' },
];

export const PAYMENT_METHODS = PAYMENT_APPS;
export const QUICK_NOTE_TEMPLATES = QUICK_NOTE_CHIPS;

export function formatINR(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getLocalIsoDate(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getLocalTimeHHMM(dateObj = new Date()) {
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatTime12h(timeStr) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '').trim());
  if (!m) return timeStr || '--:--';
  const hh24 = Math.max(0, Math.min(23, Number(m[1]) || 0));
  const mm = Math.max(0, Math.min(59, Number(m[2]) || 0));
  const period = hh24 >= 12 ? 'PM' : 'AM';
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${period}`;
}

export function sanitizeRawFinancialSnippet(rawText) {
  if (!rawText) return '';
  return String(rawText)
    .replace(/\b([0-9]{4,12})([0-9]{4})\b/g, 'XX$2')
    .replace(/\b(otp|pin|password|cvv)\s*[:\-]?\s*[0-9]{3,8}\b/gi, '$1:[REDACTED]')
    .trim()
    .slice(0, 220);
}

/**
 * Migrate and normalize any existing or newly created transaction record
 * so all Phase 5 fields are guaranteed present without losing original source info.
 */
export function migrateAndNormalizeExpenseRecord(tx) {
  if (!tx || typeof tx !== 'object') return null;
  const nowMs = Date.now();
  const ts = Number(tx.timestampMs || tx.updatedAtMs || nowMs);
  const dt = new Date(ts);
  const dateIso = tx.date && /^\d{4}-\d{2}-\d{2}$/.test(String(tx.date))
    ? String(tx.date)
    : getLocalIsoDate(dt);
  const timeHHMM = tx.time && /^\d{1,2}:\d{2}$/.test(String(tx.time))
    ? String(tx.time)
    : getLocalTimeHHMM(dt);

  const rawType = String(tx.type || 'debit').toLowerCase();
  let type = 'debit';
  if (rawType === 'credit' || rawType === 'income') type = 'credit';
  else if (rawType === 'transfer' || rawType === 'self_transfer') type = 'transfer';
  else if (rawType === 'refund' || rawType === 'reversal') type = 'refund';
  else if (rawType === 'unknown') type = 'unknown';

  const status = ['completed', 'pending', 'failed', 'reversed'].includes(tx.status)
    ? tx.status
    : 'completed';

  const source = String(tx.source || 'manual-mobile');
  const defaultReconcil = source.startsWith('manual') ? 'user_entered' : 'auto_detected';
  const reconciliationStatus = [
    'confirmed',
    'auto_detected',
    'user_entered',
    'possible_duplicate',
    'needs_review',
  ].includes(tx.reconciliationStatus)
    ? tx.reconciliationStatus
    : defaultReconcil;

  const app = String(tx.app || 'UPI');
  const paymentMethod = String(
    tx.paymentMethod ||
    (app === 'Cash' ? 'Cash' : app === 'Card' ? 'Card' : app.includes('Bank') ? 'Bank Account' : 'UPI')
  );

  const originalMerchant = String(tx.originalMerchant || tx.merchant || '').trim();
  const merchant = String(tx.merchant || originalMerchant || 'Payment').trim();
  const originalRemark = String(tx.originalRemark ?? tx.paymentRemark ?? '').trim();
  const note = String(tx.personalNote ?? tx.note ?? originalRemark ?? '').trim();
  const tags = Array.isArray(tx.tags)
    ? tx.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  return {
    ...tx,
    id: String(tx.id || `tx_${ts}`),
    currency: String(tx.currency || 'INR'),
    amount: Math.max(0, Number(Number(tx.amount || 0).toFixed(2))),
    type,
    status,
    reconciliationStatus,
    merchant,
    originalMerchant: originalMerchant || merchant,
    originalRemark,
    paymentRemark: originalRemark,
    note,
    personalNote: note,
    noteReviewed: Boolean(tx.noteReviewed || note.length > 0),
    category: String(tx.category || (type === 'credit' ? 'income' : type === 'refund' ? 'refund' : type === 'transfer' ? 'transfer' : 'food')),
    subcategory: String(tx.subcategory || ''),
    tags,
    app,
    paymentMethod,
    refId: String(tx.refId || '').trim(),
    date: dateIso,
    time: timeHHMM,
    timestampMs: ts,
    source,
    rawText: '',
    duplicateOfId: tx.duplicateOfId ? String(tx.duplicateOfId) : '',
    createdAt: String(tx.createdAt || tx.updatedAt || new Date(ts).toISOString()),
    updatedAt: String(tx.updatedAt || new Date(nowMs).toISOString()),
    updatedAtMs: Number(tx.updatedAtMs || ts),
  };
}

/**
 * Parses a Bank SMS, UPI notification, or shared receipt text into an Expense Memory record.
 * Never fabricates missing payment remarks; masks sensitive account digits.
 */
export function parseSmsOrUpiTextJs(rawText, fallbackTimestampMs = Date.now(), sourceType = 'mobile-sms-parsed') {
  const text = String(rawText || '').trim();
  if (text.length < 6) return null;
  const lower = text.toLowerCase();

  // Ignore pure OTP / PIN / verification messages
  const hasOtpWord = /(?:^|\W)(otp|one time password|verification code|upi pin|never share your pin)(?:\W|$)/i.test(lower);
  const hasCompletionWord = /(debited|credited|paid|sent\b|received|spent|withdrawn|transferred|deducted|trf to|refund|reversed|reversal|failed|declined|pending|processing|payment of|payment to|payment successful|payment completed|money sent|money received)/i.test(lower);
  if (hasOtpWord && !hasCompletionWord) return null;

  // Ignore promotional / loan spam
  if (
    /(pre-approved|apply now|loan up to|get flat|win up to|click http)/i.test(lower) &&
    !/(debited|credited|paid)/i.test(lower)
  ) {
    return null;
  }

  if (!hasCompletionWord && !/(upi\/|vpa\s)/i.test(lower)) {
    return null;
  }

  // 1. Extract Amount
  let amount = 0;
  const mPrefix = /(?:₹|rs\.?|inr|amt)\s*[:\-]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i.exec(text);
  const mSuffix = /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i.exec(text);
  const mVerb = /(?:debited|credited|paid|sent|received|spent|transferred|deducted)\s+(?:by|for|with|of)?\s*(?:₹|rs\.?|inr)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i.exec(text);
  if (mPrefix) {
    amount = parseFloat(mPrefix[1].replace(/,/g, '')) || 0;
  } else if (mSuffix) {
    amount = parseFloat(mSuffix[1].replace(/,/g, '')) || 0;
  } else if (mVerb) {
    amount = parseFloat(mVerb[1].replace(/,/g, '')) || 0;
  }
  if (amount <= 0 || amount > 100000000) return null;

  // 2. Status (completed, failed, reversed, pending)
  let status = 'completed';
  if (/(failed|declined|unsuccessful|could not be processed)/i.test(lower)) {
    status = 'failed';
  } else if (/(reversed|reversal)/i.test(lower)) {
    status = 'reversed';
  } else if (/(pending|processing)/i.test(lower)) {
    status = 'pending';
  }

  // 3. Transaction Type (debit, credit, transfer, refund)
  const isRefund = /(refund|reversed|reversal|cashback)/i.test(lower);
  const isSelfTransfer = /(self transfer|to self|own account|between your accounts)/i.test(lower);
  const isCredit = /(credited|received|deposited|added to your|upi\/cr\/|money received)/i.test(lower);
  const isDebit = /(debited|spent|paid|sent|withdrawn|deducted|trf to|upi\/dr\/|payment of|payment to|money sent)/i.test(lower);

  let type = 'debit';
  if (isSelfTransfer) type = 'transfer';
  else if (isRefund) type = 'refund';
  else if (isCredit && !isDebit) type = 'credit';

  // 4. UPI Slash pattern: UPI/<Ref>/<Merchant>/<Remark>
  let refId = '';
  let slashMerchant = '';
  let slashNote = '';
  const mSlash = /UPI\/(?:CR\/|DR\/)?([0-9]{9,14})(?:\/([^/\n\r]{2,40}))?(?:\/([^/\n\r]{2,60}))?/i.exec(text);
  if (mSlash) {
    refId = (mSlash[1] || '').trim();
    slashMerchant = (mSlash[2] || '').trim();
    slashNote = (mSlash[3] || '').trim();
  }
  if (!refId) {
    const mRef = /(?:upi\s*(?:ref)?(?:\s*no\.?|\s*id)?|utr|ref(?:erence)?(?:\s*no\.?)?|txn\s*(?:id|no\.?)?)\s*[:\-/]?\s*([0-9]{9,14})/i.exec(text);
    if (mRef) refId = mRef[1].trim();
  }

  // 5. Payment App & Method
  let app = 'Bank SMS';
  if (/(google pay|gpay|paisa\.user|okaxis|okhdfcbank|okicici|oksbi)/i.test(lower)) app = 'GPay';
  else if (/(phonepe|@ybl|@ibl|@axl)/i.test(lower)) app = 'PhonePe';
  else if (/(paytm|one97)/i.test(lower)) app = 'Paytm';
  else if (/(bhim|npci)/i.test(lower)) app = 'BHIM UPI';
  else if (/(super\.money|supermoney|money\.super)/i.test(lower)) app = 'Super.money';
  else if (/(cred\b|dreamplug)/i.test(lower)) app = 'CRED';
  else if (/(navi\b|naviapp)/i.test(lower)) app = 'Navi UPI';
  else if (/(amazon pay|amazon\.mshop)/i.test(lower)) app = 'Amazon Pay';
  else if (/(whatsapp)/i.test(lower)) app = 'WhatsApp Pay';
  else if (/(mobikwik)/i.test(lower)) app = 'MobiKwik';
  else if (/(freecharge)/i.test(lower)) app = 'Freecharge';
  else if (/(slice|indwin)/i.test(lower)) app = 'slice UPI';
  else if (/(fampay)/i.test(lower)) app = 'FamPay';
  else if (/(jupiter)/i.test(lower)) app = 'Jupiter';
  else if (/(fi money|epifi)/i.test(lower)) app = 'Fi Money';
  else if (/hdfc/i.test(lower)) app = 'HDFC Bank';
  else if (/sbi/i.test(lower)) app = 'SBI Bank';
  else if (/icici/i.test(lower)) app = 'ICICI Bank';
  else if (/axis/i.test(lower)) app = 'Axis Bank';
  else if (/kotak/i.test(lower)) app = 'Kotak Bank';
  else if (/upi/i.test(lower)) app = 'UPI';

  let paymentMethod = 'Bank Account';
  if (/(credit card|debit card|card ending|pos\s)/i.test(lower)) paymentMethod = 'Card';
  else if (/(atm|cash withdrawal)/i.test(lower)) paymentMethod = 'Cash';
  else if (/(GPay|PhonePe|Paytm|BHIM UPI|Super\.money|CRED|Navi UPI|Amazon Pay|WhatsApp Pay|MobiKwik|Freecharge|slice UPI|FamPay|Jupiter|Fi Money|UPI)/i.test(app) || /(upi|vpa)/i.test(lower)) paymentMethod = 'UPI';

  // 6. Merchant / Recipient
  let merchant = '';
  const mMerch = /(?:paid\s+to|sent\s+to|trf\s+to|transferred\s+to|to\s+vpa|received\s+from|from\s+vpa|refund\s+from|at|towards|to)\s+([A-Za-z0-9@._\-\s&]{2,36}?)(?=\s+(?:is\s+pending|on|ref|upi|utr|txn|via|for|note|remarks|a\/c|ac|acct|avl|bal|using|from|\.|,|\n|$))/i.exec(text);
  if (mMerch) {
    merchant = mMerch[1].replace(/^(mr\.?|mrs\.?|ms\.?|m\/s)\s+/i, '').trim();
  } else if (slashMerchant) {
    merchant = slashMerchant.trim();
  }
  if (!merchant) {
    if (type === 'refund') merchant = 'Refund / Reversal';
    else if (type === 'transfer') merchant = 'Self Account Transfer';
    else if (type === 'credit') merchant = app && app !== 'Bank SMS' ? `${app} Received` : 'UPI / Bank Credit';
    else merchant = app && app !== 'Bank SMS' ? `${app} Payment` : 'UPI Payment';
  }

  // 7. Original Payment Remark (only if genuinely present in message; never fabricated)
  let originalRemark = '';
  const mNote = /(?:note|remarks?|purpose|for|comment|message|description)\s*[:\-]\s*([^\n\r.;]{2,80})/i.exec(text);
  if (mNote) {
    originalRemark = mNote[1].trim();
  } else if (slashNote && !/^(upi|na|nil|payment|[0-9]+)$/i.test(slashNote.trim())) {
    originalRemark = slashNote.trim();
  }

  // 8. Category
  let category = type === 'credit' ? 'income' : type === 'refund' ? 'refund' : type === 'transfer' ? 'transfer' : 'transfer';
  const cText = `${merchant} ${originalRemark} ${text}`.toLowerCase();
  if (type === 'debit') {
    if (/(swiggy|zomato|restaurant|cafe|tea|coffee|snack|bakery|hotel|food|lunch|dinner|breakfast|biryani|pizza|kfc|dominos|burger|tiffin|canteen)/i.test(cText)) category = 'food';
    else if (/(blinkit|zepto|instamart|bigbasket|dmart|reliance|supermarket|kirana|milk|vegetable|fruit|grocery|mart|dairy)/i.test(cText)) category = 'groceries';
    else if (/(petrol|diesel|fuel|hpcl|bpcl|iocl|shell|uber|ola|rapido|metro|irctc|bus|train|toll|fastag|auto|cab)/i.test(cText)) category = 'fuel';
    else if (/(amazon|flipkart|myntra|meesho|ajio|nykaa|zudio|shopping|mall|store|cloth|shoe)/i.test(cText)) category = 'shopping';
    else if (/(jio|airtel|vi |bsnl|electricity|water|gas|cylinder|broadband|wifi|recharge|bill|dth|rent|emi)/i.test(cText)) category = 'bills';
    else if (/(apollo|medplus|pharmacy|medical|hospital|clinic|doctor|medicine|1mg|health)/i.test(cText)) category = 'medical';
    else if (/(netflix|spotify|youtube|bookmyshow|movie|cinema|hotstar|prime|game)/i.test(cText)) category = 'entertainment';
    else if (/(atm|cash withdrawal)/i.test(cText)) category = 'cash';
    else if (/(family|mom|dad|brother|sister|wife|home)/i.test(cText)) category = 'family';
  }

  const dt = new Date(fallbackTimestampMs);
  const dateIso = getLocalIsoDate(dt);
  const timeHHMM = getLocalTimeHHMM(dt);
  const id = refId
    ? `mob_ref_${refId}_${Math.round(amount)}`
    : `mob_ts_${Math.floor(fallbackTimestampMs / 120000)}_${Math.round(amount * 100)}`;

  const reconciliationStatus = status !== 'completed'
    ? 'needs_review'
    : 'auto_detected';

  return migrateAndNormalizeExpenseRecord({
    id,
    currency: 'INR',
    amount,
    type,
    status,
    reconciliationStatus,
    merchant,
    originalMerchant: merchant,
    originalRemark,
    note: originalRemark,
    noteReviewed: Boolean(originalRemark),
    category,
    subcategory: '',
    tags: [],
    app,
    paymentMethod,
    refId,
    date: dateIso,
    time: timeHHMM,
    timestampMs: fallbackTimestampMs,
    source: sourceType,
    rawText: '',
    createdAt: new Date(fallbackTimestampMs).toISOString(),
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  });
}

export function parseFinancialSmsOrNotification(input, fallbackTimestampMs = Date.now(), sourceType = 'android-notif') {
  if (input && typeof input === 'object') {
    const combinedText = [input.senderOrPkg || '', input.title || '', input.body || '', input.rawText || ''].filter(Boolean).join(' · ');
    const ts = Number(input.timestampMs || fallbackTimestampMs || Date.now());
    return parseSmsOrUpiTextJs(combinedText, ts, input.sourceType || sourceType);
  }
  return parseSmsOrUpiTextJs(input, fallbackTimestampMs, sourceType);
}

/**
 * Phase 11 — Conservative Reconciliation & Duplicate Prevention Engine.
 * Avoids double-counting a single payment when it appears in both Bank SMS and App Notification.
 * - Exact Ref ID + Amount match: merges automatically into one record, preserving user notes & original remarks.
 * - Cross-source (e.g. SMS + Notification) within 4 minutes with same Amount & Direction but missing/different Ref ID:
 *   flags the newer record as `reconciliationStatus: 'possible_duplicate'` with `duplicateOfId` so it is held for user review
 *   and NOT double-counted in spending totals!
 * - Never merges transactions solely because their amounts match when they are >4 minutes apart or both manual/same-source.
 */
export function reconcileAndMergeTransactions(existingMap = {}, incomingList = []) {
  const nextMap = {};
  for (const [k, v] of Object.entries(existingMap || {})) {
    if (!v || typeof v !== 'object') continue;
    nextMap[k] = v._deleted ? v : migrateAndNormalizeExpenseRecord(v);
  }

  let addedCount = 0;
  let mergedCount = 0;
  let duplicateFlaggedCount = 0;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  for (const rawIn of incomingList || []) {
    const incoming = migrateAndNormalizeExpenseRecord(rawIn);
    if (!incoming || !(incoming.amount > 0)) continue;

    // 1. Direct ID match
    const byId = nextMap[incoming.id];
    if (byId) {
      if (byId._deleted) continue;
      const mergedNote = byId.note || incoming.note || '';
      const mergedOriginalRemark = byId.originalRemark || incoming.originalRemark || '';
      const bestMerchant =
        byId.merchant && !byId.merchant.startsWith('UPI /') && !byId.merchant.startsWith('Bank /')
          ? byId.merchant
          : incoming.merchant || byId.merchant;
      if (
        mergedNote !== byId.note ||
        mergedOriginalRemark !== byId.originalRemark ||
        bestMerchant !== byId.merchant
      ) {
        nextMap[incoming.id] = {
          ...byId,
          merchant: bestMerchant,
          originalRemark: mergedOriginalRemark,
          note: mergedNote,
          noteReviewed: Boolean(byId.noteReviewed || mergedNote),
          updatedAt: nowIso,
          updatedAtMs: nowMs,
        };
        mergedCount += 1;
      }
      continue;
    }

    // 2. Check existing active records for Reference ID match or Cross-Source near-simultaneous match
    const activeEntries = Object.values(nextMap).filter((item) => item && !item._deleted);
    let matchedExisting = null;
    let isExactRefMatch = false;

    for (const ex of activeEntries) {
      const sameAmount = Math.abs((Number(ex.amount) || 0) - incoming.amount) < 0.01;
      const sameType = ex.type === incoming.type;
      if (!sameAmount || !sameType) continue;

      // 2a. Exact Ref ID match -> Confirmed same payment across SMS & Notification
      if (incoming.refId && ex.refId && incoming.refId === ex.refId) {
        matchedExisting = ex;
        isExactRefMatch = true;
        break;
      }

      // 2b. Conservative cross-source match within 4 minutes (240,000 ms) when at least one lacks a refId
      const timeDiffMs = Math.abs((Number(ex.timestampMs) || 0) - incoming.timestampMs);
      const differentSources = ex.source !== incoming.source;
      const lacksRef = !incoming.refId || !ex.refId;
      if (differentSources && lacksRef && timeDiffMs <= 240000 && ex.date === incoming.date) {
        matchedExisting = ex;
        isExactRefMatch = false;
        break;
      }
    }

    if (matchedExisting && isExactRefMatch) {
      // Merge enrichments into the existing record without creating a second transaction
      const mergedNote = matchedExisting.note || incoming.note || '';
      const mergedRemark = matchedExisting.originalRemark || incoming.originalRemark || '';
      const bestMerchant =
        matchedExisting.merchant && !matchedExisting.merchant.startsWith('UPI /')
          ? matchedExisting.merchant
          : incoming.merchant || matchedExisting.merchant;
      nextMap[matchedExisting.id] = {
        ...matchedExisting,
        merchant: bestMerchant,
        originalRemark: mergedRemark,
        note: mergedNote,
        noteReviewed: Boolean(matchedExisting.noteReviewed || mergedNote),
        refId: matchedExisting.refId || incoming.refId,
        updatedAt: nowIso,
        updatedAtMs: nowMs,
      };
      mergedCount += 1;
      continue;
    }

    if (matchedExisting && !isExactRefMatch) {
      // Flag as a possible duplicate for user review — never silently double-count!
      nextMap[incoming.id] = {
        ...incoming,
        reconciliationStatus: 'possible_duplicate',
        duplicateOfId: matchedExisting.id,
        updatedAt: nowIso,
        updatedAtMs: nowMs,
      };
      duplicateFlaggedCount += 1;
      addedCount += 1;
      continue;
    }

    // 3. Brand new distinct transaction
    nextMap[incoming.id] = {
      ...incoming,
      updatedAt: nowIso,
      updatedAtMs: Number(incoming.updatedAtMs || nowMs),
    };
    addedCount += 1;
  }

  return {
    nextMap,
    addedCount,
    mergedCount,
    updatedCount: mergedCount,
    duplicateFlaggedCount,
  };
}

function toTransactionArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') return Object.values(input);
  return [];
}

/**
 * Phase 6 — Smart Note & Category Suggestions based on user's past history for the same merchant.
 * Supports both (merchantName, transactions) and (expensesMap, merchantName) signatures.
 */
export function suggestNotesAndCategoryForMerchant(arg1, arg2 = []) {
  const isFirstString = typeof arg1 === 'string';
  const merchantName = isFirstString ? arg1 : (typeof arg2 === 'string' ? arg2 : '');
  const allTransactions = toTransactionArray(isFirstString ? arg2 : arg1);

  const clean = String(merchantName || '').trim().toLowerCase();
  if (!clean) {
    return { suggestedNotes: [], suggestedCategory: null, notes: [], category: null };
  }

  const noteFreq = {};
  let bestCategory = null;

  for (const tx of allTransactions) {
    if (!tx || tx._deleted) continue;
    const m = String(tx.merchant || '').trim().toLowerCase();
    if (!m) continue;
    if (m === clean || (clean.length >= 3 && (m.includes(clean) || clean.includes(m)))) {
      if (tx.category && !bestCategory) bestCategory = tx.category;
      const n = String(tx.personalNote || tx.note || '').trim();
      if (n) {
        noteFreq[n] = (noteFreq[n] || 0) + 1;
      }
    }
  }

  const suggestedNotes = Object.entries(noteFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([noteText]) => noteText);

  return {
    suggestedNotes,
    suggestedCategory: bestCategory,
    notes: suggestedNotes,
    category: bestCategory,
  };
}

/**
 * Phase 8 — Comprehensive Analytics Calculator.
 * Accepts either an Array or an Object map of transactions, and either an options object or (selectedMonth, todayIso) args.
 */
export function computeExpenseAnalytics(allTransactions = [], optionsOrMonth = {}, maybeTodayIso = undefined) {
  const txArray = toTransactionArray(allTransactions);
  const activeAll = txArray
    .filter((tx) => tx && typeof tx === 'object' && !tx._deleted && Number(tx.amount) > 0)
    .map(migrateAndNormalizeExpenseRecord)
    .sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

  let selectedMonth = '';
  let todayIso = getLocalIsoDate();
  let monthlyNetSalary = 25000;

  if (typeof optionsOrMonth === 'string') {
    selectedMonth = optionsOrMonth;
    if (typeof maybeTodayIso === 'string' && maybeTodayIso) {
      todayIso = maybeTodayIso;
    }
  } else if (optionsOrMonth && typeof optionsOrMonth === 'object') {
    selectedMonth = optionsOrMonth.selectedMonth || '';
    todayIso = optionsOrMonth.todayIso || getLocalIsoDate();
    monthlyNetSalary = Number(optionsOrMonth.monthlyNetSalary) || 25000;
  }

  const monthPrefix = selectedMonth || todayIso.slice(0, 7);

  // Compute previous month prefix for comparison
  const [yNum, mNum] = monthPrefix.split('-').map(Number);
  const prevDate = new Date(yNum || 2026, (mNum || 1) - 2, 1);
  const prevMonthPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  // Yesterday & 7-day window relative to todayIso
  const refDateObj = new Date(`${todayIso}T12:00:00`);
  const yesterdayObj = new Date(refDateObj.getTime() - 86400000);
  const yesterdayIso = getLocalIsoDate(yesterdayObj);
  const weekAgoIso = getLocalIsoDate(new Date(refDateObj.getTime() - 6 * 86400000));

  let grossExpenses = 0;
  let refundsTotal = 0;
  let incomeTotal = 0;
  let selfTransfersTotal = 0;
  let failedOrReversedTotal = 0;
  let duplicatePendingCount = 0;
  let needsReviewCount = 0;

  let monthTxCount = 0;
  let monthExpenseCount = 0;
  let monthIncomeCount = 0;
  let monthRefundCount = 0;
  let monthTransferCount = 0;

  let todaySpent = 0;
  let todayReceived = 0;
  let todayCount = 0;
  let yesterdaySpent = 0;
  let weekSpent = 0;
  let weekReceived = 0;

  let withNoteCount = 0;
  let missingNotesCount = 0;

  let prevMonthGross = 0;
  let prevMonthRefunds = 0;

  const byCategory = {};
  const byPaymentMethod = {};
  const byApp = {};
  const byDay = {};
  const byMerchant = {};
  const refundHistory = [];
  const monthActiveList = [];
  const missingNotesList = [];
  const uncertainOrDuplicatesList = [];

  for (const tx of activeAll) {
    const amt = Number(tx.amount) || 0;
    const isFailedOrReversed = tx.status === 'failed' || tx.status === 'reversed';
    const isPossibleDuplicate = tx.reconciliationStatus === 'possible_duplicate';

    // Track previous month net spend for comparison
    if (String(tx.date || '').startsWith(prevMonthPrefix) && !isFailedOrReversed && !isPossibleDuplicate) {
      if (tx.type === 'debit') prevMonthGross += amt;
      else if (tx.type === 'refund') prevMonthRefunds += amt;
    }

    // Weekly metrics (rolling 7 days up to todayIso)
    if (tx.date >= weekAgoIso && tx.date <= todayIso && !isFailedOrReversed && !isPossibleDuplicate) {
      if (tx.type === 'debit') weekSpent += amt;
      else if (tx.type === 'credit') weekReceived += amt;
    }

    // Yesterday's spend
    if (tx.date === yesterdayIso && !isFailedOrReversed && !isPossibleDuplicate) {
      if (tx.type === 'debit') yesterdaySpent += amt;
    }

    // Today's metrics
    if (tx.date === todayIso && !isFailedOrReversed && !isPossibleDuplicate) {
      todayCount += 1;
      if (tx.type === 'debit') todaySpent += amt;
      else if (tx.type === 'credit') todayReceived += amt;
    }

    // Filter to selected month for main dashboard breakdown
    if (monthPrefix && !String(tx.date || '').startsWith(monthPrefix)) {
      continue;
    }

    if (isPossibleDuplicate) {
      duplicatePendingCount += 1;
      uncertainOrDuplicatesList.push(tx);
      continue;
    }

    if (tx.reconciliationStatus === 'needs_review') {
      needsReviewCount += 1;
      uncertainOrDuplicatesList.push(tx);
    }

    if (isFailedOrReversed) {
      failedOrReversedTotal += amt;
      if (tx.status === 'reversed') refundHistory.push(tx);
      continue;
    }

    monthActiveList.push(tx);

    // Count valid transactions in this month
    monthTxCount += 1;
    const hasNote = Boolean((tx.personalNote && tx.personalNote.trim()) || (tx.note && tx.note.trim()) || tx.noteReviewed);
    if (hasNote) {
      withNoteCount += 1;
    } else {
      missingNotesCount += 1;
      missingNotesList.push(tx);
    }

    if (tx.type === 'transfer') {
      selfTransfersTotal += amt;
      monthTransferCount += 1;
    } else if (tx.type === 'refund') {
      refundsTotal += amt;
      monthRefundCount += 1;
      refundHistory.push(tx);
    } else if (tx.type === 'credit') {
      incomeTotal += amt;
      monthIncomeCount += 1;
    } else {
      grossExpenses += amt;
      monthExpenseCount += 1;

      const cat = tx.category || 'food';
      if (!byCategory[cat]) byCategory[cat] = { count: 0, amount: 0 };
      byCategory[cat].count += 1;
      byCategory[cat].amount += amt;

      const mKey = tx.merchant || 'Merchant';
      if (!byMerchant[mKey]) byMerchant[mKey] = { merchant: mKey, name: mKey, count: 0, total: 0 };
      byMerchant[mKey].count += 1;
      byMerchant[mKey].total += amt;

      if (!byDay[tx.date]) byDay[tx.date] = { date: tx.date, spent: 0, received: 0, count: 0 };
      byDay[tx.date].spent += amt;
      byDay[tx.date].count += 1;
    }

    if (tx.type === 'credit') {
      if (!byDay[tx.date]) byDay[tx.date] = { date: tx.date, spent: 0, received: 0, count: 0 };
      byDay[tx.date].received += amt;
      byDay[tx.date].count += 1;
    }

    const method = tx.paymentMethod || 'UPI';
    if (!byPaymentMethod[method]) byPaymentMethod[method] = { count: 0, spent: 0, received: 0 };
    byPaymentMethod[method].count += 1;
    if (tx.type === 'debit') byPaymentMethod[method].spent += amt;
    else if (tx.type === 'credit') byPaymentMethod[method].received += amt;

    const appName = tx.app || 'UPI';
    if (!byApp[appName]) byApp[appName] = { count: 0, spent: 0, received: 0 };
    byApp[appName].count += 1;
    if (tx.type === 'debit') byApp[appName].spent += amt;
    else if (tx.type === 'credit') byApp[appName].received += amt;
  }

  const netSpending = Math.max(0, Number((grossExpenses - refundsTotal).toFixed(2)));
  const prevMonthNetSpend = Math.max(0, Number((prevMonthGross - prevMonthRefunds).toFixed(2)));
  const periodComparisonPct = prevMonthNetSpend > 0
    ? Math.round(((netSpending - prevMonthNetSpend) / prevMonthNetSpend) * 100)
    : null;

  const remainingSalary = Math.max(0, Number(((Number(monthlyNetSalary) || 0) - netSpending).toFixed(2)));
  const noteCompletionPct = monthTxCount > 0 ? Math.round((withNoteCount / monthTxCount) * 100) : 100;

  const categoryBreakdown = Object.entries(byCategory)
    .map(([category, info]) => {
      const catMeta = EXPENSE_CATEGORIES.find(
        (c) => c.id === category || c.label === category || c.id.toLowerCase() === String(category).toLowerCase()
      ) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
      return {
        category,
        icon: catMeta?.icon || '💳',
        color: catMeta?.color || '#3b82f6',
        count: info.count,
        total: Number(info.amount.toFixed(2)),
        sharePct: grossExpenses > 0 ? (info.amount / grossExpenses) * 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const paymentMethodBreakdown = Object.entries(byPaymentMethod)
    .map(([method, info]) => ({
      method,
      count: info.count,
      total: Number(info.spent.toFixed(2)),
      received: Number(info.received.toFixed(2)),
      sharePct: grossExpenses > 0 ? (info.spent / grossExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const appBreakdown = Object.entries(byApp)
    .map(([app, info]) => ({
      app,
      method: app,
      count: info.count,
      total: Number(info.spent.toFixed(2)),
      received: Number(info.received.toFixed(2)),
      sharePct: grossExpenses > 0 ? (info.spent / grossExpenses) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const dailyTrend = Object.values(byDay)
    .map((d) => ({
      date: d.date,
      total: Number(d.spent.toFixed(2)),
      spent: Number(d.spent.toFixed(2)),
      received: Number(d.received.toFixed(2)),
      count: d.count,
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const highestSpendingDay = [...dailyTrend].sort((a, b) => b.total - a.total)[0] || null;

  const topMerchant = Object.values(byMerchant).sort((a, b) => b.total - a.total)[0] || null;
  const prevMonthComparison = prevMonthNetSpend > 0
    ? {
        prevTotal: prevMonthNetSpend,
        diff: Number((netSpending - prevMonthNetSpend).toFixed(2)),
        pctChange: periodComparisonPct || 0,
      }
    : null;

  const insights = [];
  if (categoryBreakdown.length > 0) {
    insights.push(
      `Top category is ${categoryBreakdown[0].category} (₹${formatINR(categoryBreakdown[0].total)}, ${Math.round(categoryBreakdown[0].sharePct)}% of spending).`
    );
  }
  if (topMerchant) {
    insights.push(
      `Most spent at ${topMerchant.merchant}: ₹${formatINR(topMerchant.total)} across ${topMerchant.count} payment${topMerchant.count === 1 ? '' : 's'}.`
    );
  }
  if (missingNotesCount > 0) {
    insights.push(
      `${missingNotesCount} payment${missingNotesCount === 1 ? '' : 's'} still need a personal memory note.`
    );
  }

  return {
    grossExpenses: Number(grossExpenses.toFixed(2)),
    grossSpent: Number(grossExpenses.toFixed(2)),
    refundsTotal: Number(refundsTotal.toFixed(2)),
    totalRefunds: Number(refundsTotal.toFixed(2)),
    netSpending,
    netSpent: netSpending,
    incomeTotal: Number(incomeTotal.toFixed(2)),
    totalIncome: Number(incomeTotal.toFixed(2)),
    totalReceived: Number(incomeTotal.toFixed(2)),
    selfTransfersTotal: Number(selfTransfersTotal.toFixed(2)),
    failedOrReversedTotal: Number(failedOrReversedTotal.toFixed(2)),
    duplicatePendingCount,
    needsReviewCount,
    totalCount: monthTxCount,
    monthTxCount,
    monthExpenseCount,
    monthIncomeCount,
    monthRefundCount,
    monthTransferCount,
    todaySpent: Number(todaySpent.toFixed(2)),
    todayReceived: Number(todayReceived.toFixed(2)),
    todayCount,
    yesterdaySpent: Number(yesterdaySpent.toFixed(2)),
    weekSpent: Number(weekSpent.toFixed(2)),
    weekReceived: Number(weekReceived.toFixed(2)),
    withNoteCount,
    missingNotesCount,
    noteCompletionPct,
    prevMonthNetSpend,
    periodComparisonPct,
    spendChangePct: periodComparisonPct,
    prevMonthComparison,
    remainingSalary,
    byCategory,
    byPaymentMethod,
    byApp,
    byDay,
    refundHistory,
    monthActiveList,
    monthTxList: monthActiveList,
    categoryBreakdown,
    paymentMethodBreakdown,
    methodBreakdown: paymentMethodBreakdown,
    appBreakdown,
    dailyTrend,
    dailySeries: dailyTrend,
    highestSpendingDay,
    highestSpendDay: highestSpendingDay,
    insights,
    missingNotesList,
    uncertainOrDuplicatesList,
    topMerchant,
  };
}

/**
 * Phase 8 — Natural-Language Question & Answer Engine over real local transaction records.
 */
export function answerNaturalLanguageFinanceQuery(query, allTransactions = [], monthOrToday = getLocalIsoDate(), maybeTodayIso = undefined) {
  const q = String(query || '').trim().toLowerCase();
  const txArray = toTransactionArray(allTransactions);
  const todayIso = maybeTodayIso
    ? maybeTodayIso
    : (String(monthOrToday || '').length === 10 ? monthOrToday : getLocalIsoDate());
  const monthPrefix = String(monthOrToday || '').length === 7 ? monthOrToday : todayIso.slice(0, 7);

  const stats = computeExpenseAnalytics(txArray, { selectedMonth: monthPrefix, todayIso });
  const active = txArray
    .filter((tx) => tx && !tx._deleted && tx.status !== 'failed' && tx.status !== 'reversed' && tx.reconciliationStatus !== 'possible_duplicate')
    .map(migrateAndNormalizeExpenseRecord);

  if (!q) {
    return {
      title: 'Ask Expense Memory anything',
      answer: `This month (${monthPrefix}) you have made ${stats.monthTxCount} transactions totaling ₹${formatINR(stats.netSpending)} in net spending.`,
      matchedIds: [],
    };
  }

  if (q.includes('yesterday')) {
    const refDateObj = new Date(`${todayIso}T12:00:00`);
    const yesterdayIso = getLocalIsoDate(new Date(refDateObj.getTime() - 86400000));
    const matches = active.filter((tx) => tx.date === yesterdayIso && tx.type === 'debit');
    return {
      title: `Yesterday's Spending (${yesterdayIso})`,
      answer: `You spent ₹${formatINR(stats.yesterdaySpent)} across ${matches.length} expense transaction${matches.length === 1 ? '' : 's'} yesterday.`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  if (q.includes('how many transaction') || q.includes('transaction count')) {
    const matches = active.filter((tx) => tx.date.startsWith(monthPrefix));
    return {
      title: `Transactions in ${monthPrefix}`,
      answer: `You have ${stats.monthTxCount} confirmed transactions this month (${stats.monthExpenseCount} expenses, ${stats.monthIncomeCount} received, ${stats.monthRefundCount} refunds, ${stats.monthTransferCount} transfers).`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  if (q.includes('food') || q.includes('lunch') || q.includes('dinner') || q.includes('tea') || q.includes('snack')) {
    const matches = active.filter(
      (tx) =>
        tx.date.startsWith(monthPrefix) &&
        tx.type === 'debit' &&
        (tx.category === 'food' || String(tx.category || '').toLowerCase().includes('food') || /(food|tea|coffee|lunch|dinner|snack|swiggy|zomato|bakery|restaurant)/i.test(`${tx.note} ${tx.merchant}`))
    );
    const sum = matches.reduce((acc, t) => acc + t.amount, 0);
    return {
      title: 'Food & Dining Expenses',
      answer: `Found ${matches.length} food & dining transaction${matches.length === 1 ? '' : 's'} this month totaling ₹${formatINR(sum)}.`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  if (q.includes("don't have note") || q.includes('missing note') || q.includes('without note') || q.includes('no note')) {
    const matches = active.filter((tx) => tx.date.startsWith(monthPrefix) && !(tx.note && tx.note.trim()) && !tx.noteReviewed);
    return {
      title: 'Payments Missing Notes',
      answer:
        matches.length === 0
          ? "You're all caught up! Every tracked transaction this month has a note or has been reviewed."
          : `${matches.length} transaction${matches.length === 1 ? '' : 's'} this month ${matches.length === 1 ? 'is' : 'are'} missing a personal note.`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  if (q.includes('receive') && q.includes('week')) {
    const refDateObj = new Date(`${todayIso}T12:00:00`);
    const weekAgoIso = getLocalIsoDate(new Date(refDateObj.getTime() - 6 * 86400000));
    const matches = active.filter((tx) => tx.date >= weekAgoIso && tx.date <= todayIso && tx.type === 'credit');
    return {
      title: 'Received This Week (Last 7 Days)',
      answer: `You received ₹${formatINR(stats.weekReceived)} across ${matches.length} incoming transaction${matches.length === 1 ? '' : 's'} in the last 7 days.`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  const mAbove = /(?:above|over|more than|>)\s*₹?\s*([0-9,]+)/i.exec(q);
  if (mAbove) {
    const threshold = parseFloat(mAbove[1].replace(/,/g, '')) || 1000;
    const matches = active.filter((tx) => tx.amount >= threshold);
    const sum = matches.reduce((acc, t) => acc + t.amount, 0);
    return {
      title: `Transactions Above ₹${formatINR(threshold)}`,
      answer: `Found ${matches.length} transaction${matches.length === 1 ? '' : 's'} of ₹${formatINR(threshold)} or more (totaling ₹${formatINR(sum)}).`,
      matchedIds: matches.map((t) => t.id),
    };
  }

  // Fallback keyword search across merchant, note, category, refId
  const matches = active.filter((tx) =>
    `${tx.merchant} ${tx.note} ${tx.originalRemark} ${tx.category} ${tx.app} ${tx.refId} ${(tx.tags || []).join(' ')}`
      .toLowerCase()
      .includes(q)
  );
  const sum = matches.reduce((acc, t) => acc + t.amount, 0);
  return {
    title: `Search Results for "${query}"`,
    answer: `Found ${matches.length} matching transaction${matches.length === 1 ? '' : 's'} totaling ₹${formatINR(sum)} from your local records.`,
    matchedIds: matches.map((t) => t.id),
  };
}

function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Phase 8 & 12 — RFC-4180 compliant CSV Exporter with full disclosure of fields.
 */
export function formatTransactionsCsv(transactions = [], analytics = null) {
  const txList = toTransactionArray(transactions);
  const headers = [
    'Tx ID',
    'Date',
    'Time',
    'Type',
    'Status',
    'Amount (INR)',
    'Currency',
    'Merchant / Recipient',
    'Personal Note (Purpose)',
    'Original Payment Remark',
    'Category',
    'Subcategory',
    'Tags',
    'Payment Method',
    'Payment App',
    'Bank / UPI Ref',
    'Ingestion Source',
    'Reconciliation Status',
  ];

  const rows = [headers.map(escapeCsvCell).join(',')];

  for (const rawTx of txList) {
    const tx = migrateAndNormalizeExpenseRecord(rawTx);
    if (!tx || tx._deleted) continue;
    rows.push(
      [
        tx.id,
        tx.date,
        formatTime12h(tx.time),
        tx.type.toUpperCase(),
        tx.status.toUpperCase(),
        tx.amount.toFixed(2),
        tx.currency,
        tx.merchant,
        tx.note,
        tx.originalRemark,
        tx.category,
        tx.subcategory,
        (tx.tags || []).join('; '),
        tx.paymentMethod,
        tx.app,
        tx.refId,
        tx.source,
        tx.reconciliationStatus,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  }

  if (analytics) {
    rows.push('');
    rows.push([escapeCsvCell('Summary Metric'), escapeCsvCell('Value')].join(','));
    rows.push([escapeCsvCell('Total Confirmed Transactions'), escapeCsvCell(analytics.monthTxCount)].join(','));
    rows.push([escapeCsvCell('Gross Expenses (INR)'), escapeCsvCell(analytics.grossExpenses.toFixed(2))].join(','));
    rows.push([escapeCsvCell('Refunds & Reversals (INR)'), escapeCsvCell(analytics.refundsTotal.toFixed(2))].join(','));
    rows.push([escapeCsvCell('Net Spending (INR)'), escapeCsvCell(analytics.netSpending.toFixed(2))].join(','));
    rows.push([escapeCsvCell('Total Income Received (INR)'), escapeCsvCell(analytics.incomeTotal.toFixed(2))].join(','));
    rows.push([escapeCsvCell('Self Transfers Excluded (INR)'), escapeCsvCell(analytics.selfTransfersTotal.toFixed(2))].join(','));
  }

  return rows.join('\r\n');
}

/**
 * Launches a local Android UPI Intent (upi://pay) with pre-filled payee, amount, and note.
 * Does not make any HTTP/network request.
 */
export function launchUpiPayment({
  payeeVpa = '',
  payeeName = '',
  amount = '',
  note = '',
  pa = '',
  pn = '',
  am = '',
  tn = '',
} = {}) {
  const cleanPa = String(payeeVpa || pa || '').trim();
  const cleanPn = String(payeeName || pn || '').trim();
  const cleanAm = Number(amount || am || 0);
  const cleanTn = String(note || tn || '').trim();
  const params = new URLSearchParams();
  if (cleanPa) params.set('pa', cleanPa);
  if (cleanPn) params.set('pn', cleanPn);
  if (cleanAm > 0) params.set('am', cleanAm.toFixed(2));
  if (cleanTn) params.set('tn', cleanTn);
  params.set('cu', 'INR');
  const upiUri = `upi://pay?${params.toString()}`;
  try {
    if (typeof window !== 'undefined') {
      if (window.PattanBiometric?.launchUpiUri) {
        return Boolean(window.PattanBiometric.launchUpiUri(upiUri));
      }
      window.location.href = upiUri;
      return true;
    }
  } catch (_) {
    // ignore
  }
  return false;
}

