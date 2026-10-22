import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import JSZip from 'jszip';

const UDHAAR_STORAGE_KEY = 'yasin_udhaar_returnable_ledger_v1';
const UDHAAR_BIOMETRIC_LOCK_KEY = 'yasin_udhaar_biometric_lock_enabled_v1';
const UDHAAR_OTA_VERSION_KEY = 'udhaar_standalone_ota_version_v1';
const UDHAAR_OTA_BUILD_ID_KEY = 'udhaar_standalone_ota_build_id_v1';
const BUILTIN_UDHAAR_OTA_VERSION = '1.0.3';
const BUILTIN_UDHAAR_OTA_BUILD_ID = 'udhaar_ota_1_0_3_created_by_pattan_yasin_screenshot_ocr_biometric_lock';

// Separate Dedicated Udhaar OTA Server Endpoints (Strictly isolated from Salary & OT OTA server)
const UDHAAR_OTA_BASES = [
  'https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar',
  'https://cdn.jsdelivr.net/gh/Yasin144/female-presentator@main/ota-udhaar',
];

const PAYMENT_MODES = ['PhonePe', 'GPay', 'Paytm', 'Cash', 'UPI', 'Bank'];

function getTodayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getCurrentTimeHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getRelativeDateIso(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatINR(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatShortDate(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return `${d} ${months[m] || parts[1]}`;
}

function formatTime12h(hhmm) {
  if (!hhmm) return '';
  const [hStr, mStr] = String(hhmm).split(':');
  const h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${mStr || '00'} ${ampm}`;
}

// Compute payment breakdown: how many times paid, each payment's amount/mode/date, total paid, and remaining to pay
function getPaymentStats(item) {
  const totalAmount = Math.max(0, Number(item?.amount) || 0);
  const rawPayments = Array.isArray(item?.payments) ? item.payments : [];
  let paidList = rawPayments
    .filter((p) => p && Number(p.amount) > 0)
    .map((p, idx) => ({
      id: p.id || `pay_${idx}`,
      amount: Number(p.amount) || 0,
      paidThrough: String(p.paidThrough || p.mode || 'UPI').trim(),
      paidDate: String(p.paidDate || p.date || item?.date || getTodayIso()).trim(),
      paidTime: String(p.paidTime || p.time || '').trim(),
      note: String(p.note || '').trim(),
    }));

  // Preserve legacy single paidAmount if payments array was not populated yet
  const legacyPaid = Math.max(0, Number(item?.paidAmount) || 0);
  const sumFromList = paidList.reduce((acc, p) => acc + p.amount, 0);
  if (paidList.length === 0 && legacyPaid > 0) {
    paidList = [
      {
        id: 'pay_legacy_1',
        amount: legacyPaid,
        paidThrough: String(item?.paidThrough || 'UPI'),
        paidDate: String(item?.returnedAt || item?.date || getTodayIso()),
        paidTime: '',
        note: 'Recorded payment',
      },
    ];
  }

  const totalPaid = paidList.length > 0 ? paidList.reduce((acc, p) => acc + p.amount, 0) : sumFromList;
  const isReturned = item?.status === 'returned' || (totalAmount > 0 && totalPaid >= totalAmount);
  const effectivePaid = isReturned ? Math.max(totalPaid, totalAmount) : totalPaid;
  const remaining = isReturned ? 0 : Math.max(0, totalAmount - totalPaid);
  const paidCount = paidList.length > 0 ? paidList.length : isReturned ? 1 : 0;

  return {
    totalAmount,
    paidList,
    paidCount,
    totalPaid: effectivePaid,
    remaining,
    isReturned,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL FILE & SHEET PARSER (Excel .xlsx/.xls, CSV, TSV, Word .docx, PDF, JSON, TXT)
// Automatically reads internal document data and creates Udhaar persons
// according to Sheet Name and how much each person has to pay!
// ═══════════════════════════════════════════════════════════════════════════
function parseAmountNumber(rawVal) {
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) return Math.abs(rawVal);
  if (rawVal === null || rawVal === undefined) return NaN;
  const str = String(rawVal)
    .replace(/(?:Rs\.?|INR|₹|\$)/gi, '')
    .replace(/,/g, '')
    .trim();
  if (!str) return NaN;
  // Reject 10-digit phone numbers or YYYY-MM-DD dates
  if (/^\d{10,12}$/.test(str) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(str) || /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(str)) {
    return NaN;
  }
  const num = Number(str);
  return Number.isFinite(num) && num > 0 && num < 100000000 ? num : NaN;
}

function isLikelyHeaderWord(str) {
  const s = String(str || '').trim().toLowerCase();
  return /^(s\.?no|sr\.?no|sl\.?no|id|name|person|friend|customer|party|member|amount|money|udhaar|udhar|balance|to\s*pay|due|total|paid|received|remaining|pending|date|time|mode|paid\s*through|via|status|note|remarks?|description|particulars|sheet|mobile|phone|contact)$/i.test(
    s
  );
}

function isGenericSheetName(name) {
  const s = String(name || '').trim();
  if (!s) return true;
  return /^(sheet\s*\d*|page\s*\d*|table\s*\d*|data|udhaar|udhar|ledger|list|summary|report|book\d*|export|untitled|document)$/i.test(s);
}

function cleanFileBaseName(fileName) {
  return String(fileName || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function parseRowsFromSheetGrid(rows2D, sheetName = 'Sheet1', fallbackFileName = '') {
  const cleanSheet = String(sheetName || cleanFileBaseName(fallbackFileName) || 'Sheet').trim();
  const nonEmptyRows = (rows2D || [])
    .map((r) => (Array.isArray(r) ? r.map((c) => (c === null || c === undefined ? '' : String(c).trim())) : []))
    .filter((r) => r.some((c) => c !== ''));

  if (nonEmptyRows.length === 0) return [];

  // Detect header row if present
  let headerIdx = -1;
  let colMap = { name: -1, amount: -1, toPay: -1, paid: -1, mode: -1, date: -1, note: -1 };

  for (let i = 0; i < Math.min(5, nonEmptyRows.length); i++) {
    const row = nonEmptyRows[i];
    let matchedCols = 0;
    const candidateMap = { name: -1, amount: -1, toPay: -1, paid: -1, mode: -1, date: -1, note: -1 };
    row.forEach((cell, cIdx) => {
      const low = cell.toLowerCase();
      if (candidateMap.name === -1 && /\b(name|person|friend|party|customer|member|who|borrower)\b/.test(low)) {
        candidateMap.name = cIdx;
        matchedCols++;
      } else if (candidateMap.toPay === -1 && /\b(to\s*pay|balance|remaining|pending|due|left|net)\b/.test(low)) {
        candidateMap.toPay = cIdx;
        matchedCols++;
      } else if (candidateMap.paid === -1 && /\b(paid|returned|received|given\s*back)\b/.test(low) && !/through|via|mode|date/.test(low)) {
        candidateMap.paid = cIdx;
        matchedCols++;
      } else if (candidateMap.amount === -1 && /\b(amount|money|udhaar|udhar|total|loan|took|given|rs|inr|₹|price|value)\b/.test(low)) {
        candidateMap.amount = cIdx;
        matchedCols++;
      } else if (candidateMap.mode === -1 && /\b(through|via|mode|method|app|upi|cash|bank)\b/.test(low)) {
        candidateMap.mode = cIdx;
        matchedCols++;
      } else if (candidateMap.date === -1 && /\b(date|when|day)\b/.test(low)) {
        candidateMap.date = cIdx;
        matchedCols++;
      } else if (candidateMap.note === -1 && /\b(note|remark|reason|for\s*what|item|detail)\b/.test(low)) {
        candidateMap.note = cIdx;
        matchedCols++;
      }
    });
    if (matchedCols >= 2 || (candidateMap.name !== -1 && (candidateMap.amount !== -1 || candidateMap.toPay !== -1))) {
      headerIdx = i;
      colMap = candidateMap;
      break;
    }
  }

  const extractedPeople = [];
  const startRow = headerIdx !== -1 ? headerIdx + 1 : 0;

  for (let i = startRow; i < nonEmptyRows.length; i++) {
    const row = nonEmptyRows[i];
    if (row.length === 0) continue;

    // Skip grand total footer rows if other person rows already exist
    const firstNonEmpty = row.find((c) => c !== '') || '';
    if (/^(grand\s*total|total\s*amount|sub\s*total|sum)$/i.test(firstNonEmpty) && extractedPeople.length > 0) {
      continue;
    }

    let personName = '';
    let totalAmt = NaN;
    let paidAmt = 0;
    let paidMode = 'UPI';
    let entryDate = getTodayIso();
    let entryNote = '';

    if (headerIdx !== -1) {
      if (colMap.name !== -1 && row[colMap.name]) personName = row[colMap.name];
      const rawTotal = colMap.amount !== -1 ? parseAmountNumber(row[colMap.amount]) : NaN;
      const rawToPay = colMap.toPay !== -1 ? parseAmountNumber(row[colMap.toPay]) : NaN;
      const rawPaid = colMap.paid !== -1 ? parseAmountNumber(row[colMap.paid]) : NaN;

      if (Number.isFinite(rawPaid)) paidAmt = rawPaid;
      if (Number.isFinite(rawTotal)) {
        totalAmt = rawTotal;
      } else if (Number.isFinite(rawToPay)) {
        totalAmt = rawToPay + paidAmt;
      }
      if (colMap.mode !== -1 && row[colMap.mode]) paidMode = row[colMap.mode];
      if (colMap.note !== -1 && row[colMap.note]) entryNote = row[colMap.note];
    }

    // Fallback row heuristic: find first text cell (name) and numeric cells (money)
    if (!personName || !Number.isFinite(totalAmt)) {
      const textCells = [];
      const numCells = [];
      for (const cell of row) {
        if (!cell) continue;
        const num = parseAmountNumber(cell);
        if (Number.isFinite(num)) {
          numCells.push(num);
        } else if (!/^\d+$/.test(cell) && !isLikelyHeaderWord(cell)) {
          textCells.push(cell);
        }
      }
      if (!personName && textCells.length > 0) {
        personName = textCells[0];
        if (textCells.length > 1 && !entryNote) entryNote = textCells.slice(1).join(' · ');
      }
      if (!Number.isFinite(totalAmt) && numCells.length > 0) {
        totalAmt = numCells[0];
        if (numCells.length >= 2 && paidAmt === 0 && numCells[1] <= numCells[0]) {
          // If 3 numbers: [Total, Paid, Balance] -> check if num0 - num1 == num2
          if (numCells.length >= 3 && Math.abs(numCells[0] - numCells[1] - numCells[2]) < 2) {
            paidAmt = numCells[1];
          }
        }
      }
    }

    // What if the Sheet itself is named after the person (e.g. Sheet Name = "Raju") and rows inside are amounts/items?
    if ((!personName || /^(amount|money|balance|to\s*pay|total|item|cash|upi|\d+)$/i.test(personName)) && Number.isFinite(totalAmt)) {
      if (!isGenericSheetName(cleanSheet)) {
        if (personName && !/^(amount|money|balance|to\s*pay|total)$/i.test(personName)) {
          entryNote = entryNote ? `${personName} · ${entryNote}` : personName;
        }
        personName = cleanSheet;
      }
    }

    if (personName && Number.isFinite(totalAmt) && totalAmt > 0 && !isLikelyHeaderWord(personName)) {
      extractedPeople.push({
        person: personName.trim(),
        amount: totalAmt,
        paidAmount: paidAmt,
        paidThrough: paidMode,
        date: entryDate,
        note: entryNote,
        sheetName: cleanSheet,
      });
    }
  }

  // Special Case: If the Sheet Name IS a Person's Name (e.g. Sheet "Kiran" has 4 rows of items/amounts for Kiran),
  // merge them under that Sheet Name so one clean Udhaar Person is created for that Sheet with total money to pay!
  if (
    extractedPeople.length > 1 &&
    !isGenericSheetName(cleanSheet) &&
    extractedPeople.every((p) => p.person.toLowerCase() === cleanSheet.toLowerCase())
  ) {
    const sumAmount = extractedPeople.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const sumPaid = extractedPeople.reduce((acc, p) => acc + (Number(p.paidAmount) || 0), 0);
    const combinedNotes = extractedPeople
      .map((p) => p.note)
      .filter(Boolean)
      .slice(0, 4)
      .join(', ');
    return [
      {
        person: cleanSheet,
        amount: sumAmount,
        paidAmount: sumPaid,
        paidThrough: extractedPeople[0].paidThrough || 'UPI',
        date: getTodayIso(),
        note: combinedNotes || `From sheet ${cleanSheet} (${extractedPeople.length} items)`,
        sheetName: cleanSheet,
      },
    ];
  }

  return extractedPeople;
}

function parseFreeTextIntoPeople(rawText, sheetName = 'Document') {
  const cleanSheet = String(sheetName || 'Document').trim();
  const text = String(rawText || '').trim();
  if (!text) return [];

  // 1. Try JSON first
  if ((text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const rows = parsed.map((obj) => {
          if (Array.isArray(obj)) return obj;
          if (obj && typeof obj === 'object') {
            return [
              obj.person || obj.name || obj.Name || obj.friend || obj.party || '',
              obj.amount || obj.money || obj.Amount || obj.toPay || obj.balance || obj.total || '',
              obj.paidAmount || obj.paid || obj.Paid || 0,
              obj.paidThrough || obj.mode || obj.via || 'UPI',
              obj.note || obj.remark || '',
            ];
          }
          return [String(obj)];
        });
        const res = parseRowsFromSheetGrid([['Name', 'Amount', 'Paid', 'Mode', 'Note'], ...rows], cleanSheet);
        if (res.length > 0) return res;
      } else if (parsed && typeof parsed === 'object') {
        const out = [];
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) {
            const sub = parseFreeTextIntoPeople(JSON.stringify(v), k);
            out.push(...sub);
          } else {
            const num = parseAmountNumber(v);
            if (Number.isFinite(num)) {
              out.push({
                person: k,
                amount: num,
                paidAmount: 0,
                paidThrough: 'UPI',
                date: getTodayIso(),
                note: '',
                sheetName: cleanSheet,
              });
            }
          }
        }
        if (out.length > 0) return out;
      }
    } catch (_) {}
  }

  // 2. Check for HTML / XML Table (.xls or HTML table export)
  if (/<table|<tr|<td|<Worksheet|<Row|<Cell/i.test(text)) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const worksheets = doc.querySelectorAll('worksheet, table');
      const allExtracted = [];
      if (worksheets.length > 0) {
        worksheets.forEach((ws, idx) => {
          const wsName =
            ws.getAttribute('ss:name') ||
            ws.getAttribute('name') ||
            ws.getAttribute('id') ||
            (worksheets.length === 1 ? cleanSheet : `${cleanSheet} #${idx + 1}`);
          const trList = ws.querySelectorAll('tr, row');
          const grid = [];
          trList.forEach((tr) => {
            const cells = [];
            tr.querySelectorAll('td, th, cell, data').forEach((td) => {
              cells.push((td.textContent || '').trim());
            });
            if (cells.length > 0) grid.push(cells);
          });
          allExtracted.push(...parseRowsFromSheetGrid(grid, wsName));
        });
        if (allExtracted.length > 0) return allExtracted;
      }
    } catch (_) {}
  }

  // 3. Check for CSV / TSV lines
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.some((l) => l.includes(',') || l.includes('\t') || l.includes('|'))) {
    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes('|') ? '|' : ',';
    const grid = lines.map((line) =>
      line
        .split(sep)
        .map((cell) => cell.replace(/^["']|["']$/g, '').trim())
    );
    const csvRes = parseRowsFromSheetGrid(grid, cleanSheet);
    if (csvRes.length > 0) return csvRes;
  }

  // 4. Parse free-form text lines (e.g. "Raju - 1500", "1. Kiran ₹2,500 paid 500", "Salman: 800")
  const freeResults = [];
  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim();
    if (!cleanLine || cleanLine.length > 180) continue;

    // Look for "paid <amount>" inside the line
    let paidAmt = 0;
    let paidVia = 'UPI';
    const paidMatch = cleanLine.match(/\b(?:paid|returned|given\s*back)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (paidMatch) {
      const pNum = parseAmountNumber(paidMatch[1]);
      if (Number.isFinite(pNum)) paidAmt = pNum;
    }
    const viaMatch = cleanLine.match(/\b(phonepe|gpay|google\s*pay|paytm|cash|upi|bank)\b/i);
    if (viaMatch) {
      paidVia = viaMatch[1];
    }

    // Remove the "paid ..." part before extracting main Name + Amount
    const mainPart = cleanLine.replace(/\b(?:paid|returned|given\s*back)\s*(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?.*$/i, '').trim();

    // Pattern A: "Name ... ₹1,500"
    const matchNameFirst = mainPart.match(
      /^([A-Za-z][A-Za-z0-9\s._()-]{1,40}?)\s*[:=\-–—,\s]\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)\b/i
    );
    if (matchNameFirst) {
      const name = matchNameFirst[1].replace(/\b(rs|inr|amount|money|to\s*pay|udhaar|udhar)\b/gi, '').trim();
      const amt = parseAmountNumber(matchNameFirst[2]);
      if (name && !isLikelyHeaderWord(name) && Number.isFinite(amt)) {
        freeResults.push({
          person: name,
          amount: amt,
          paidAmount: paidAmt,
          paidThrough: paidVia,
          date: getTodayIso(),
          note: '',
          sheetName: cleanSheet,
        });
        continue;
      }
    }

    // Pattern B: "₹1,500 - Name"
    const matchAmtFirst = mainPart.match(
      /^(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)\s*[:=\-–—,\s]\s*([A-Za-z][A-Za-z0-9\s._()-]{1,40})$/i
    );
    if (matchAmtFirst) {
      const amt = parseAmountNumber(matchAmtFirst[1]);
      const name = matchAmtFirst[2].replace(/\b(rs|inr|amount|money|to\s*pay|udhaar|udhar)\b/gi, '').trim();
      if (name && !isLikelyHeaderWord(name) && Number.isFinite(amt)) {
        freeResults.push({
          person: name,
          amount: amt,
          paidAmount: paidAmt,
          paidThrough: paidVia,
          date: getTodayIso(),
          note: '',
          sheetName: cleanSheet,
        });
      }
    }
  }

  // 5. Screenshot / Receipt / Multi-line pairing (e.g. UPI Screenshot "Paid to <Name>" + "₹<Amount>", or Name on one line & Amount on the next line)
  if (freeResults.length === 0 && lines.length >= 2) {
    // Check UPI receipt screenshot pattern ("Paid to / Sent to / To: <Name>" and "₹ 500")
    const joinedText = lines.join('\n');
    const upiNameMatch = joinedText.match(
      /(?:paid\s+to|sent\s+to|transfer(?:red)?\s+to|received\s+from|to)\s*[:\-]?\s*\n?\s*([A-Za-z][A-Za-z\s.]{2,34})/i
    );
    const upiAmtMatch = joinedText.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i);
    if (upiNameMatch && upiAmtMatch) {
      const cleanUpiName = upiNameMatch[1].split(/\r?\n/)[0].trim();
      const cleanUpiAmt = parseAmountNumber(upiAmtMatch[1]);
      if (cleanUpiName && !isLikelyHeaderWord(cleanUpiName) && Number.isFinite(cleanUpiAmt)) {
        freeResults.push({
          person: cleanUpiName,
          amount: cleanUpiAmt,
          paidAmount: 0,
          paidThrough: 'UPI',
          date: getTodayIso(),
          note: 'Imported from Screenshot',
          sheetName: cleanSheet,
        });
      }
    }

    // Check adjacent lines where Line i is a Name and Line i+1 is an Amount (common in table/list screenshots)
    if (freeResults.length === 0) {
      for (let i = 0; i < lines.length - 1; i++) {
        const l1 = lines[i].replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim();
        const l2 = lines[i + 1].replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim();
        const amt2 = parseAmountNumber(l2);
        const isL1Name =
          /^[A-Za-z][A-Za-z\s._-]{1,32}$/.test(l1) &&
          !isLikelyHeaderWord(l1) &&
          !/\b(transaction|successful|completed|utr|ref|bank|google|paytm|cred|bhim|history|statement)\b/i.test(l1);
        if (isL1Name && Number.isFinite(amt2)) {
          freeResults.push({
            person: l1,
            amount: amt2,
            paidAmount: 0,
            paidThrough: 'UPI',
            date: getTodayIso(),
            note: '',
            sheetName: cleanSheet,
          });
          i++; // skip paired amount line
        }
      }
    }
  }

  // If the file only had numbers and the file/sheet name is a person's name
  if (freeResults.length === 0 && !isGenericSheetName(cleanSheet)) {
    const nums = [];
    for (const line of lines) {
      const n = parseAmountNumber(line);
      if (Number.isFinite(n)) nums.push(n);
    }
    if (nums.length > 0) {
      const total = nums.reduce((a, b) => a + b, 0);
      return [
        {
          person: cleanSheet,
          amount: total,
          paidAmount: 0,
          paidThrough: 'UPI',
          date: getTodayIso(),
          note: `Imported from ${cleanSheet}`,
          sheetName: cleanSheet,
        },
      ];
    }
  }

  return freeResults;
}

// Parse Excel .xlsx or Word .docx using JSZip
async function parseZipBasedDocument(arrayBuffer, fileName) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const results = [];

  // 1. Check if it is an Excel .xlsx file (has xl/workbook.xml)
  const workbookFile = zip.file('xl/workbook.xml');
  if (workbookFile) {
    const parser = new DOMParser();

    // Load Shared Strings (xl/sharedStrings.xml)
    const sharedStrings = [];
    const ssFile = zip.file('xl/sharedStrings.xml');
    if (ssFile) {
      const ssXml = await ssFile.async('string');
      const ssDoc = parser.parseFromString(ssXml, 'application/xml');
      const siNodes = ssDoc.getElementsByTagName('si');
      for (let i = 0; i < siNodes.length; i++) {
        const tNodes = siNodes[i].getElementsByTagName('t');
        let combined = '';
        for (let j = 0; j < tNodes.length; j++) {
          combined += tNodes[j].textContent || '';
        }
        sharedStrings.push(combined.trim());
      }
    }

    // Map r:id -> target worksheet path from xl/_rels/workbook.xml.rels
    const relMap = {};
    const relsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (relsFile) {
      const relsXml = await relsFile.async('string');
      const relsDoc = parser.parseFromString(relsXml, 'application/xml');
      const relNodes = relsDoc.getElementsByTagName('Relationship');
      for (let i = 0; i < relNodes.length; i++) {
        const id = relNodes[i].getAttribute('Id');
        const target = relNodes[i].getAttribute('Target');
        if (id && target) {
          relMap[id] = target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`;
        }
      }
    }

    // Read sheet names in order from xl/workbook.xml
    const wbXml = await workbookFile.async('string');
    const wbDoc = parser.parseFromString(wbXml, 'application/xml');
    const sheetNodes = wbDoc.getElementsByTagName('sheet');

    const colLettersToIndex = (letters) => {
      let col = 0;
      for (let i = 0; i < letters.length; i++) {
        col = col * 26 + (letters.charCodeAt(i) - 64);
      }
      return Math.max(0, col - 1);
    };

    for (let sIdx = 0; sIdx < sheetNodes.length; sIdx++) {
      const sheetNode = sheetNodes[sIdx];
      const sheetName = sheetNode.getAttribute('name') || `Sheet${sIdx + 1}`;
      const rId = sheetNode.getAttribute('r:id') || sheetNode.getAttribute('id');
      const targetPath = (rId && relMap[rId]) || `xl/worksheets/sheet${sIdx + 1}.xml`;
      const wsFile = zip.file(targetPath) || zip.file(`xl/worksheets/sheet${sIdx + 1}.xml`);
      if (!wsFile) continue;

      const wsXml = await wsFile.async('string');
      const wsDoc = parser.parseFromString(wsXml, 'application/xml');
      const rowNodes = wsDoc.getElementsByTagName('row');
      const rows2D = [];

      for (let r = 0; r < rowNodes.length; r++) {
        const cNodes = rowNodes[r].getElementsByTagName('c');
        const rowArr = [];
        for (let c = 0; c < cNodes.length; c++) {
          const cell = cNodes[c];
          const ref = cell.getAttribute('r') || '';
          const colLetters = (ref.match(/^[A-Z]+/i) || [''])[0].toUpperCase();
          const colIdx = colLetters ? colLettersToIndex(colLetters) : c;
          const cellType = cell.getAttribute('t') || '';

          let val = '';
          if (cellType === 'inlineStr') {
            const tNodes = cell.getElementsByTagName('t');
            val = tNodes.length > 0 ? tNodes[0].textContent || '' : '';
          } else {
            const vNodes = cell.getElementsByTagName('v');
            const rawV = vNodes.length > 0 ? vNodes[0].textContent || '' : '';
            if (cellType === 's') {
              const sIndex = parseInt(rawV, 10);
              val = !Number.isNaN(sIndex) && sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex] : rawV;
            } else {
              val = rawV;
            }
          }
          rowArr[colIdx] = String(val).trim();
        }
        rows2D.push(rowArr);
      }

      const sheetPeople = parseRowsFromSheetGrid(rows2D, sheetName, fileName);
      results.push(...sheetPeople);
    }

    return results;
  }

  // 2. Check if it is a Word .docx file (has word/document.xml)
  const wordFile = zip.file('word/document.xml');
  if (wordFile) {
    const wordXml = await wordFile.async('string');
    const parser = new DOMParser();
    const wDoc = parser.parseFromString(wordXml, 'application/xml');
    const sheetLabel = cleanFileBaseName(fileName) || 'Word Doc';

    // Check Word tables first
    const trNodes = wDoc.getElementsByTagName('w:tr');
    if (trNodes.length > 0) {
      const grid = [];
      for (let r = 0; r < trNodes.length; r++) {
        const tcNodes = trNodes[r].getElementsByTagName('w:tc');
        const rowCells = [];
        for (let c = 0; c < tcNodes.length; c++) {
          const tNodes = tcNodes[c].getElementsByTagName('w:t');
          let txt = '';
          for (let t = 0; t < tNodes.length; t++) txt += tNodes[t].textContent || '';
          rowCells.push(txt.trim());
        }
        grid.push(rowCells);
      }
      const tableRes = parseRowsFromSheetGrid(grid, sheetLabel, fileName);
      if (tableRes.length > 0) return tableRes;
    }

    // Paragraphs fallback
    const pNodes = wDoc.getElementsByTagName('w:p');
    const lines = [];
    for (let p = 0; p < pNodes.length; p++) {
      const tNodes = pNodes[p].getElementsByTagName('w:t');
      let line = '';
      for (let t = 0; t < tNodes.length; t++) line += tNodes[t].textContent || '';
      if (line.trim()) lines.push(line.trim());
    }
    return parseFreeTextIntoPeople(lines.join('\n'), sheetLabel);
  }

  return results;
}

// Compress an image file onto a canvas and return a JPEG dataURL (for fast Screenshot OCR)
async function imageFileToCompressedDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 1400;
            let w = img.width || 800;
            let h = img.height || 800;
            if (w > maxDim || h > maxDim) {
              const scale = maxDim / Math.max(w, h);
              w = Math.round(w * scale);
              h = Math.round(h * scale);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), imgElement: img });
          } catch (_) {
            resolve({ dataUrl: String(reader.result || ''), imgElement: img });
          }
        };
        img.onerror = () => resolve({ dataUrl: String(reader.result || ''), imgElement: null });
        img.src = String(reader.result || '');
      };
      reader.onerror = () => resolve({ dataUrl: '', imgElement: null });
      reader.readAsDataURL(file);
    } catch (_) {
      resolve({ dataUrl: '', imgElement: null });
    }
  });
}

// Multi-layer Screenshot OCR Reader: reads text & tables from any uploaded screenshot (.png, .jpg, .webp)
async function extractScreenshotText(file) {
  const { dataUrl, imgElement } = await imageFileToCompressedDataUrl(file);

  // Layer 1: Native Android / Chrome Shape Detection API (window.TextDetector) if available
  if (typeof window !== 'undefined' && typeof window.TextDetector === 'function' && imgElement) {
    try {
      const detector = new window.TextDetector();
      const blocks = await detector.detect(imgElement);
      if (Array.isArray(blocks) && blocks.length > 0) {
        const sorted = [...blocks].sort((a, b) => {
          const ay = a.boundingBox?.top || 0;
          const by = b.boundingBox?.top || 0;
          if (Math.abs(ay - by) <= 14) {
            return (a.boundingBox?.left || 0) - (b.boundingBox?.left || 0);
          }
          return ay - by;
        });
        // Merge blocks on the same horizontal row into a single line
        const rowLines = [];
        let currentRowY = null;
        let currentRowParts = [];
        for (const blk of sorted) {
          const val = String(blk.rawValue || '').trim();
          if (!val) continue;
          const topY = blk.boundingBox?.top || 0;
          if (currentRowY === null || Math.abs(topY - currentRowY) <= 14) {
            currentRowParts.push(val);
            if (currentRowY === null) currentRowY = topY;
          } else {
            rowLines.push(currentRowParts.join(' \t '));
            currentRowParts = [val];
            currentRowY = topY;
          }
        }
        if (currentRowParts.length > 0) rowLines.push(currentRowParts.join(' \t '));
        const joinedNative = rowLines.join('\n');
        if (joinedNative.trim().length > 2) return { text: joinedNative, dataUrl };
      }
    } catch (_) {}
  }

  // Layer 2: Cloud Table & Receipt OCR Engine (ocr.space Engine 2 & Engine 1 fallback)
  if (dataUrl) {
    for (const engineNum of ['2', '1']) {
      try {
        const formData = new FormData();
        formData.append('apikey', 'helloworld');
        formData.append('base64Image', dataUrl);
        formData.append('language', 'eng');
        formData.append('isTable', 'true');
        formData.append('scale', 'true');
        formData.append('OCREngine', engineNum);

        const res = await fetch('https://api.ocr.space/parse/image', {
          method: 'POST',
          body: formData,
        });
        if (res.ok) {
          const json = await res.json();
          const parsedText = json?.ParsedResults?.[0]?.ParsedText || '';
          if (String(parsedText).trim().length > 2) {
            return { text: String(parsedText).trim(), dataUrl };
          }
        }
      } catch (_) {}
    }
  }

  return { text: '', dataUrl };
}

// Extract text from Screenshot Image, Excel, Word, PDF, CSV, or arbitrary binary/text file
async function extractUniversalFilePeople(file) {
  const fileName = file?.name || 'Uploaded File';
  const baseSheetName = cleanFileBaseName(fileName) || 'Imported Sheet';
  const isImageFile =
    /^image\//i.test(String(file?.type || '')) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(fileName);

  // 0. If user uploaded a Screenshot / Image, run Screenshot OCR!
  if (isImageFile) {
    const { text: ocrText, dataUrl } = await extractScreenshotText(file);
    const ocrPeople = ocrText ? parseFreeTextIntoPeople(ocrText, baseSheetName) : [];
    return {
      people: ocrPeople,
      isScreenshot: true,
      screenshotDataUrl: dataUrl,
      rawOcrText: ocrText,
    };
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);

  // Check ZIP signature (PK\x03\x04) -> .xlsx, .docx, .ods, .zip
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const zipRes = await parseZipBasedDocument(arrayBuffer, fileName);
      if (zipRes.length > 0) return { people: zipRes, isScreenshot: false };
    } catch (_) {}
  }

  // Decode UTF-8 / Latin1 text
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

  // Check if PDF (%PDF-)
  if (utf8Text.startsWith('%PDF-') || /\.pdf$/i.test(fileName)) {
    const extractedStrings = [];
    const literalRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*(?:Tj|')/g;
    let m;
    while ((m = literalRegex.exec(utf8Text)) !== null) {
      extractedStrings.push(m[1].replace(/\\([()\\])/g, '$1'));
    }
    const tjArrayRegex = /\[((?:[^[\]]|\([^)]*\))*)\]\s*TJ/g;
    while ((m = tjArrayRegex.exec(utf8Text)) !== null) {
      const inner = m[1];
      const subParts = [];
      const subRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
      let sm;
      while ((sm = subRegex.exec(inner)) !== null) {
        subParts.push(sm[1].replace(/\\([()\\])/g, '$1'));
      }
      if (subParts.length > 0) extractedStrings.push(subParts.join(''));
    }
    if (extractedStrings.length > 0) {
      const pdfPeople = parseFreeTextIntoPeople(extractedStrings.join('\n'), baseSheetName);
      if (pdfPeople.length > 0) return { people: pdfPeople, isScreenshot: false };
    }
  }

  // Universal text / CSV / TSV / JSON / HTML / XML parser
  return { people: parseFreeTextIntoPeople(utf8Text, baseSheetName), isScreenshot: false };
}

export default function UdhaarStandaloneApp({
  embedded = false,
  isLight: propIsLight = false,
  palette: propPalette = null,
  externalDraft = null,
  externalDraftRequest = null,
  onClearExternalDraft = null,
  onShowToast = null,
  onToast = null,
}) {
  const [themeLight, setThemeLight] = useState(propIsLight);
  const isLight = embedded ? propIsLight : themeLight;

  const palette = useMemo(() => {
    if (embedded && propPalette) return propPalette;
    return isLight
      ? {
          bg: '#f1f5f9',
          surface: '#ffffff',
          surfaceAlt: '#f8fafc',
          border: '#e2e8f0',
          text: '#0f172a',
          textSub: '#334155',
          textMuted: '#64748b',
        }
      : {
          bg: '#090d16',
          surface: '#111827',
          surfaceAlt: '#1e293b',
          border: 'rgba(148, 163, 184, 0.2)',
          text: '#f8fafc',
          textSub: '#cbd5e1',
          textMuted: '#94a3b8',
        };
  }, [embedded, propPalette, isLight]);

  const [toastMsg, setToastMsg] = useState('');
  const notify = useCallback(
    (msg) => {
      const cb = onShowToast || onToast;
      if (embedded && typeof cb === 'function') {
        cb(msg);
      } else {
        setToastMsg(msg);
        setTimeout(() => setToastMsg(''), 3200);
      }
    },
    [embedded, onShowToast, onToast]
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // SEPARATE INDIVIDUAL UDHAAR OTA ENGINE (ota-udhaar/udhaar-ota-manifest.json)
  // Strictly isolated from Salary & OT OTA server
  // ═══════════════════════════════════════════════════════════════════════════
  const [udhaarOtaVersion, setUdhaarOtaVersion] = useState(() => {
    try {
      return localStorage.getItem(UDHAAR_OTA_VERSION_KEY) || BUILTIN_UDHAAR_OTA_VERSION;
    } catch (_) {
      return BUILTIN_UDHAAR_OTA_VERSION;
    }
  });
  const [udhaarOtaBusy, setUdhaarOtaBusy] = useState(false);
  const [availableUdhaarOta, setAvailableUdhaarOta] = useState(null);

  const checkUdhaarOtaAvailability = useCallback(async () => {
    if (embedded || udhaarOtaBusy) return null;
    try {
      const ts = Date.now();
      let manifest = null;
      let activeBase = UDHAAR_OTA_BASES[0];
      for (const base of UDHAAR_OTA_BASES) {
        try {
          const res = await fetch(`${base}/udhaar-ota-manifest.json?t=${ts}`, { cache: 'no-store' });
          if (res.ok) {
            manifest = await res.json();
            activeBase = base;
            break;
          }
        } catch (_) {}
      }
      if (!manifest || !manifest.buildId || manifest.appType !== 'udhaar-only') return null;

      let currentBuildId = BUILTIN_UDHAAR_OTA_BUILD_ID;
      try {
        currentBuildId = localStorage.getItem(UDHAAR_OTA_BUILD_ID_KEY) || BUILTIN_UDHAAR_OTA_BUILD_ID;
      } catch (_) {}

      if (manifest.buildId !== currentBuildId) {
        const info = {
          version: String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION),
          buildId: String(manifest.buildId),
          notes: String(manifest.notes || 'New Udhaar Tracker update ready'),
          jsFile: String(manifest.jsFile || 'udhaar-bundle.js'),
          cssFile: String(manifest.cssFile || 'udhaar-bundle.css'),
          baseUrl: activeBase,
        };
        setAvailableUdhaarOta(info);
        return info;
      }
      setAvailableUdhaarOta(null);
    } catch (_) {}
    return null;
  }, [embedded, udhaarOtaBusy]);

  const applyUdhaarOtaUpdate = useCallback(async () => {
    if (embedded || udhaarOtaBusy) return;
    setUdhaarOtaBusy(true);
    notify('Checking Udhaar OTA Server...');
    try {
      const ts = Date.now();
      let manifest = null;
      let activeBase = UDHAAR_OTA_BASES[0];
      for (const base of UDHAAR_OTA_BASES) {
        try {
          const res = await fetch(`${base}/udhaar-ota-manifest.json?t=${ts}`, { cache: 'no-store' });
          if (res.ok) {
            manifest = await res.json();
            activeBase = base;
            break;
          }
        } catch (_) {}
      }
      if (!manifest || !manifest.buildId || manifest.appType !== 'udhaar-only') {
        notify('Could not reach Udhaar OTA Server');
        setUdhaarOtaBusy(false);
        return;
      }

      const jsRes = await fetch(`${activeBase}/${manifest.jsFile || 'udhaar-bundle.js'}?t=${ts}`, { cache: 'no-store' });
      const cssRes = await fetch(`${activeBase}/${manifest.cssFile || 'udhaar-bundle.css'}?t=${ts}`, { cache: 'no-store' });
      if (!jsRes.ok) {
        notify('Failed to download Udhaar bundle');
        setUdhaarOtaBusy(false);
        return;
      }
      const rawJs = await jsRes.text();
      const rawCss = cssRes.ok ? await cssRes.text() : '';
      const safeUdhaarJs = rawJs.startsWith('window.__UDHAAR_ONLY_APK__')
        ? rawJs
        : `window.__UDHAAR_ONLY_APK__ = true;\n${rawJs}`;

      try {
        localStorage.setItem(UDHAAR_OTA_VERSION_KEY, String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION));
        localStorage.setItem(UDHAAR_OTA_BUILD_ID_KEY, String(manifest.buildId));
      } catch (_) {}
      setUdhaarOtaVersion(String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION));
      setAvailableUdhaarOta(null);

      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.saveLiveOtaBundle === 'function'
      ) {
        const saved = window.PattanBiometric.saveLiveOtaBundle(
          String(manifest.version || BUILTIN_UDHAAR_OTA_VERSION),
          String(manifest.buildId),
          safeUdhaarJs,
          rawCss
        );
        if (saved) {
          notify(`Updated Udhaar App to v${manifest.version}! Reloading...`);
          setTimeout(() => window.location.reload(), 600);
          return;
        }
      }
      notify(`Udhaar App is up to date (v${manifest.version})`);
    } catch (_) {
      notify('Update check failed');
    } finally {
      setUdhaarOtaBusy(false);
    }
  }, [embedded, udhaarOtaBusy, notify]);

  useEffect(() => {
    if (embedded) return undefined;
    checkUdhaarOtaAvailability();
    const timer = setInterval(checkUdhaarOtaAvailability, 25000);
    return () => clearInterval(timer);
  }, [embedded, checkUdhaarOtaAvailability]);

  // Collapsible Header State (Tap header to Minimize / Maximize)
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem('yasin_udhaar_simple_minimized_v1') === '1';
    } catch (_) {
      return false;
    }
  });

  const toggleMinimized = () => {
    setMinimized((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('yasin_udhaar_simple_minimized_v1', next ? '1' : '0');
      } catch (_) {}
      return next;
    });
  };

  // Saved Udhaar List
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(UDHAAR_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (_) {}
    return [];
  });

  const saveItems = useCallback((updater) => {
    setItems((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        localStorage.setItem(UDHAAR_STORAGE_KEY, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  }, []);

  // Simple Form State
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => getTodayIso());
  const [time, setTime] = useState(() => getCurrentTimeHHMM());
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');

  // Filter: 'pending' | 'returned'
  const [tab, setTab] = useState('pending');
  const [selectedSheetFilter, setSelectedSheetFilter] = useState('ALL');

  // Inline "Record Paid" Drawer State (for recording when he paid, how much, paid through, paid date)
  const [payItemId, setPayItemId] = useState(null);
  const [payAmountDraft, setPayAmountDraft] = useState('');
  const [payThroughDraft, setPayThroughDraft] = useState('PhonePe');
  const [payDateDraft, setPayDateDraft] = useState(() => getTodayIso());
  const [payTimeDraft, setPayTimeDraft] = useState(() => getCurrentTimeHHMM());
  const [payNoteDraft, setPayNoteDraft] = useState('');

  // Universal File / Screenshot Upload State
  const fileInputRef = useRef(null);
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState(null);
  const [uploadedScreenshotPreview, setUploadedScreenshotPreview] = useState(null);

  // Optional Biometric Lock State (OFF by default; when enabled, locks Udhaar data until fingerprint/screen unlock)
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(() => {
    try {
      return localStorage.getItem(UDHAAR_BIOMETRIC_LOCK_KEY) === '1';
    } catch (_) {
      return false;
    }
  });
  const [isVaultLocked, setIsVaultLocked] = useState(() => {
    try {
      return localStorage.getItem(UDHAAR_BIOMETRIC_LOCK_KEY) === '1';
    } catch (_) {
      return false;
    }
  });
  const pendingBioIntentRef = useRef('unlock'); // 'unlock' | 'disable'

  useEffect(() => {
    const onBioResult = (ev) => {
      const detail = ev?.detail || {};
      if (detail.actionType && !String(detail.actionType).startsWith('udhaar')) return;
      if (detail.ok) {
        if (pendingBioIntentRef.current === 'disable') {
          setBiometricLockEnabled(false);
          setIsVaultLocked(false);
          try {
            localStorage.setItem(UDHAAR_BIOMETRIC_LOCK_KEY, '0');
          } catch (_) {}
          notify('🔓 Biometric Lock Disabled');
        } else {
          setIsVaultLocked(false);
          notify('🔓 Udhaar Unlocked');
        }
      } else if (detail.error) {
        notify(`🔒 ${detail.error}`);
      }
    };
    window.addEventListener('pattan-biometric-result', onBioResult);
    return () => window.removeEventListener('pattan-biometric-result', onBioResult);
  }, [notify]);

  // Auto-lock when app goes to background ONLY if user enabled Biometric Lock
  useEffect(() => {
    if (!biometricLockEnabled) return undefined;
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        setIsVaultLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [biometricLockEnabled]);

  const requestBiometricAuth = useCallback(
    (intent = 'unlock') => {
      pendingBioIntentRef.current = intent;
      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.authenticate === 'function'
      ) {
        window.PattanBiometric.authenticate(
          'udhaar-unlock',
          intent === 'disable' ? 'Disable Udhaar Biometric Lock' : 'Unlock Udhaar Tracker',
          'Use your fingerprint, face, or phone screen lock'
        );
        return;
      }
      // Browser fallback when testing outside Android APK
      if (intent === 'disable') {
        setBiometricLockEnabled(false);
        setIsVaultLocked(false);
        try {
          localStorage.setItem(UDHAAR_BIOMETRIC_LOCK_KEY, '0');
        } catch (_) {}
        notify('🔓 Biometric Lock Disabled');
      } else {
        setIsVaultLocked(false);
        notify('🔓 Udhaar Unlocked');
      }
    },
    [notify]
  );

  const toggleBiometricLockSetting = useCallback(() => {
    if (!biometricLockEnabled) {
      setBiometricLockEnabled(true);
      setIsVaultLocked(false);
      try {
        localStorage.setItem(UDHAAR_BIOMETRIC_LOCK_KEY, '1');
      } catch (_) {}
      notify('🔒 Biometric Lock Enabled! Data is now protected.');
    } else {
      requestBiometricAuth('disable');
    }
  }, [biometricLockEnabled, notify, requestBiometricAuth]);

  // Simple Edit Modal State
  const [editItem, setEditItem] = useState(null);

  // Pre-fill when user taps 🤝 on a transaction in Expenses
  const activeExternalDraft = externalDraft || externalDraftRequest;
  useEffect(() => {
    if (activeExternalDraft && typeof activeExternalDraft === 'object') {
      setMinimized(false);
      setPerson(activeExternalDraft.person || '');
      setAmount(activeExternalDraft.amount ? String(activeExternalDraft.amount) : '');
      setDate(activeExternalDraft.tookDate || activeExternalDraft.date || getTodayIso());
      setTime(activeExternalDraft.tookTime || activeExternalDraft.time || getCurrentTimeHHMM());
      setNote(activeExternalDraft.note || '');
      if (typeof onClearExternalDraft === 'function') {
        onClearExternalDraft();
      }
    }
  }, [activeExternalDraft, onClearExternalDraft]);

  const handleAdd = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const cleanName = String(person || '').trim();
    const numAmt = Number(amount);
    if (!cleanName || !(numAmt > 0)) {
      notify('Enter Friend Name and Amount');
      return;
    }
    const newItem = {
      id: `udh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      person: cleanName,
      amount: numAmt,
      paidAmount: 0,
      payments: [],
      date: date || getTodayIso(),
      time: time || getCurrentTimeHHMM(),
      note: String(note || '').trim(),
      phone: String(phone || '').replace(/[^0-9+]/g, ''),
      sheetName: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    saveItems((prev) => [newItem, ...prev]);
    setPerson('');
    setAmount('');
    setNote('');
    setPhone('');
    setDate(getTodayIso());
    setTime(getCurrentTimeHHMM());
    setTab('pending');
    notify(`Saved ₹${formatINR(numAmt)} for ${cleanName}`);
  };

  // Open inline "Record Paid" box for a person
  const openRecordPayment = (item) => {
    if (payItemId === item.id) {
      setPayItemId(null);
      return;
    }
    const stats = getPaymentStats(item);
    setPayItemId(item.id);
    setPayAmountDraft(stats.remaining > 0 ? String(stats.remaining) : '');
    setPayThroughDraft('PhonePe');
    setPayDateDraft(getTodayIso());
    setPayTimeDraft(getCurrentTimeHHMM());
    setPayNoteDraft('');
  };

  // Save a new payment installment (how much he paid, paid through, paid date & time)
  const handleSavePayment = (item) => {
    const paidNum = Number(payAmountDraft);
    if (!(paidNum > 0)) {
      notify('Enter how much he paid');
      return;
    }
    const newPayment = {
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      amount: paidNum,
      paidThrough: payThroughDraft || 'UPI',
      paidDate: payDateDraft || getTodayIso(),
      paidTime: payTimeDraft || getCurrentTimeHHMM(),
      note: String(payNoteDraft || '').trim(),
    };

    saveItems((prev) =>
      prev.map((entry) => {
        if (entry.id !== item.id) return entry;
        const stats = getPaymentStats(entry);
        const updatedPayments = [...stats.paidList, newPayment];
        const newTotalPaid = updatedPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
        const totalAmt = Number(entry.amount) || 0;
        const isFullyPaid = newTotalPaid >= totalAmt;
        return {
          ...entry,
          payments: updatedPayments,
          paidAmount: newTotalPaid,
          status: isFullyPaid ? 'returned' : 'pending',
          returnedAt: isFullyPaid ? payDateDraft || getTodayIso() : entry.returnedAt || null,
        };
      })
    );

    setPayItemId(null);
    setPayAmountDraft('');
    setPayNoteDraft('');
    notify(`✅ Recorded ₹${formatINR(paidNum)} paid via ${payThroughDraft} on ${formatShortDate(payDateDraft)}`);
  };

  // Remove an individual payment entry from history
  const handleRemovePaymentRecord = (itemId, paymentId) => {
    saveItems((prev) =>
      prev.map((entry) => {
        if (entry.id !== itemId) return entry;
        const stats = getPaymentStats(entry);
        const updatedPayments = stats.paidList.filter((p) => p.id !== paymentId);
        const newTotalPaid = updatedPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
        const totalAmt = Number(entry.amount) || 0;
        return {
          ...entry,
          payments: updatedPayments,
          paidAmount: newTotalPaid,
          status: newTotalPaid >= totalAmt && totalAmt > 0 ? 'returned' : 'pending',
        };
      })
    );
    notify('Removed payment entry');
  };

  // Universal File & Screenshot Upload Handler (Screenshots, Excel, CSV, PDF, Word, JSON, TXT, etc.)
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;

    setIsImportingFile(true);
    try {
      const extracted = await extractUniversalFilePeople(file);
      const parsedPeople = Array.isArray(extracted) ? extracted : extracted?.people || [];
      if (extracted?.isScreenshot && extracted?.screenshotDataUrl) {
        setUploadedScreenshotPreview({
          fileName: file.name,
          dataUrl: extracted.screenshotDataUrl,
          ocrText: extracted.rawOcrText || '',
          count: parsedPeople.length,
        });
      } else {
        setUploadedScreenshotPreview(null);
      }

      if (!parsedPeople || parsedPeople.length === 0) {
        if (extracted?.isScreenshot) {
          notify('📷 Screenshot attached! Enter Name & Amount from screenshot above.');
        } else {
          notify(`Could not find Name & Amount rows in "${file.name}".`);
        }
        setIsImportingFile(false);
        return;
      }

      const nowTs = Date.now();
      const createdIds = [];
      const newEntries = parsedPeople.map((p, idx) => {
        const id = `udh_imp_${nowTs}_${idx}`;
        createdIds.push(id);
        const totalAmt = Number(p.amount) || 0;
        const initPaid = Math.max(0, Number(p.paidAmount) || 0);
        const initPayments =
          initPaid > 0
            ? [
                {
                  id: `pay_imp_${nowTs}_${idx}`,
                  amount: initPaid,
                  paidThrough: p.paidThrough || 'UPI',
                  paidDate: p.date || getTodayIso(),
                  paidTime: getCurrentTimeHHMM(),
                  note: extracted?.isScreenshot ? 'Read from Screenshot' : 'Imported from file',
                },
              ]
            : [];
        const isDone = totalAmt > 0 && initPaid >= totalAmt;
        return {
          id,
          person: p.person,
          amount: totalAmt,
          paidAmount: initPaid,
          payments: initPayments,
          date: p.date || getTodayIso(),
          time: getCurrentTimeHHMM(),
          note: p.note || (extracted?.isScreenshot ? 'From Screenshot' : ''),
          phone: '',
          sheetName: p.sheetName || cleanFileBaseName(file.name),
          status: isDone ? 'returned' : 'pending',
          createdAt: new Date().toISOString(),
        };
      });

      saveItems((prev) => [...newEntries, ...prev]);
      const sheetsFound = Array.from(new Set(newEntries.map((x) => x.sheetName).filter(Boolean)));
      const totalToPayImported = newEntries.reduce(
        (acc, x) => acc + Math.max(0, (Number(x.amount) || 0) - (Number(x.paidAmount) || 0)),
        0
      );

      setLastImportSummary({
        fileName: file.name,
        count: newEntries.length,
        sheets: sheetsFound,
        totalToPay: totalToPayImported,
        createdIds,
      });
      setTab('pending');
      notify(
        `✅ Read ${newEntries.length} person(s) from ${extracted?.isScreenshot ? 'Screenshot' : file.name}!`
      );
    } catch (_) {
      notify('Could not read file. Try Screenshot, Excel (.xlsx), CSV, TXT, or PDF.');
    } finally {
      setIsImportingFile(false);
    }
  };

  const handleUndoLastImport = () => {
    if (!lastImportSummary?.createdIds?.length) return;
    const idSet = new Set(lastImportSummary.createdIds);
    saveItems((prev) => prev.filter((item) => !idSet.has(item.id)));
    setLastImportSummary(null);
    notify('↩️ Undid file import');
  };

  const toggleStatus = (id) => {
    saveItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const stats = getPaymentStats(item);
        if (stats.isReturned) {
          return {
            ...item,
            status: 'pending',
            returnedAt: null,
          };
        }
        // Marking as Returned records any remaining balance as paid today
        const updatedPayments =
          stats.remaining > 0
            ? [
                ...stats.paidList,
                {
                  id: `pay_${Date.now()}`,
                  amount: stats.remaining,
                  paidThrough: 'Cash/UPI',
                  paidDate: getTodayIso(),
                  paidTime: getCurrentTimeHHMM(),
                  note: 'Full settlement',
                },
              ]
            : stats.paidList;
        return {
          ...item,
          payments: updatedPayments,
          paidAmount: Number(item.amount) || 0,
          status: 'returned',
          returnedAt: getTodayIso(),
        };
      })
    );
  };

  const deleteEntry = (id) => {
    saveItems((prev) => prev.filter((item) => item.id !== id));
    setEditItem(null);
    notify('Entry deleted');
  };

  const saveEdit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!editItem) return;
    const cleanName = String(editItem.person || '').trim();
    const totalAmt = Number(editItem.amount) || 0;
    if (!cleanName || !(totalAmt > 0)) return;

    saveItems((prev) =>
      prev.map((item) => {
        if (item.id !== editItem.id) return item;
        const stats = getPaymentStats(item);
        const isNowReturned = stats.totalPaid >= totalAmt && totalAmt > 0 ? 'returned' : editItem.status;
        return {
          ...item,
          person: cleanName,
          amount: totalAmt,
          date: editItem.date || getTodayIso(),
          time: editItem.time || '12:00',
          note: String(editItem.note || '').trim(),
          phone: String(editItem.phone || '').replace(/[^0-9+]/g, ''),
          sheetName: String(editItem.sheetName || '').trim(),
          status: isNowReturned,
        };
      })
    );
    setEditItem(null);
    notify(`Updated ${cleanName}`);
  };

  const sendWhatsAppReminder = (item) => {
    const stats = getPaymentStats(item);
    const dateLabel = `${formatShortDate(item.date)}${item.time ? ` at ${formatTime12h(item.time)}` : ''}`;
    const paidHistoryText =
      stats.paidCount > 0
        ? ` (Paid ₹${formatINR(stats.totalPaid)} in ${stats.paidCount} time${stats.paidCount > 1 ? 's' : ''})`
        : '';
    const msg = `Hi ${item.person}, friendly reminder for Udhaar balance ₹${formatINR(stats.remaining)} to pay (Total ₹${formatINR(stats.totalAmount)} taken on ${dateLabel}${paidHistoryText})${item.note ? ` - ${item.note}` : ''}.`;
    const digits = String(item.phone || '').replace(/[^0-9]/g, '');
    const phoneParam = digits.length === 10 ? `91${digits}` : digits;
    const url = phoneParam
      ? `https://wa.me/${phoneParam}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const allSheetNames = useMemo(() => {
    const set = new Set();
    for (const item of items) {
      if (item?.sheetName) set.add(item.sheetName);
    }
    return Array.from(set);
  }, [items]);

  const summary = useMemo(() => {
    let pendingTotal = 0;
    let returnedTotal = 0;
    let pendingCount = 0;
    let returnedCount = 0;
    for (const item of items) {
      if (!item) continue;
      if (selectedSheetFilter !== 'ALL' && item.sheetName !== selectedSheetFilter) continue;
      const stats = getPaymentStats(item);
      if (stats.isReturned) {
        returnedTotal += stats.totalAmount;
        returnedCount += 1;
      } else {
        pendingTotal += stats.remaining;
        returnedTotal += stats.totalPaid;
        pendingCount += 1;
      }
    }
    return { pendingTotal, returnedTotal, pendingCount, returnedCount };
  }, [items, selectedSheetFilter]);

  const visibleItems = useMemo(
    () =>
      items.filter((i) => {
        if (!i) return false;
        if (selectedSheetFilter !== 'ALL' && i.sheetName !== selectedSheetFilter) return false;
        const stats = getPaymentStats(i);
        return tab === 'pending' ? !stats.isReturned : stats.isReturned;
      }),
    [items, tab, selectedSheetFilter]
  );

  const cardContent = (
    <div
      style={{
        borderRadius: 20,
        background: palette.surface,
        border: `1px solid ${palette.border}`,
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* 1. CLEAN HEADER — TAP ANYWHERE TO MINIMIZE / MAXIMIZE + TOP RIGHT CREATED BY PATTAN YASIN */}
      <div
        onClick={toggleMinimized}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤝</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 900, color: palette.text }}>
              Udhaar Tracker {minimized ? '▸' : '▾'}
            </div>
            <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 600 }}>
              Track who took, how many times paid &amp; balance
            </div>
          </div>
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}
        >
          {/* Top-Right Corner Author Badge */}
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: isLight ? '#eef2ff' : 'rgba(99, 102, 241, 0.16)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              color: isLight ? '#4338ca' : '#a5b4fc',
              fontSize: 9.5,
              fontWeight: 900,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}
          >
            ✨ Created by Pattan Yasin
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Optional Biometric Lock Enable / Disable Toggle */}
            <button
              type="button"
              onClick={toggleBiometricLockSetting}
              style={{
                padding: '4px 8px',
                borderRadius: 999,
                border: biometricLockEnabled ? '1px solid #10b981' : `1px solid ${palette.border}`,
                background: biometricLockEnabled ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                color: biometricLockEnabled ? '#10b981' : palette.textMuted,
                fontSize: 10.5,
                fontWeight: 800,
                cursor: 'pointer',
              }}
              title="Optional Biometric Lock: Enable or Disable"
            >
              {biometricLockEnabled ? '🔒 Lock: ON' : '🔓 Lock: OFF'}
            </button>

            {biometricLockEnabled && !isVaultLocked && (
              <button
                type="button"
                onClick={() => setIsVaultLocked(true)}
                style={{
                  padding: '4px 7px',
                  borderRadius: 999,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.textSub,
                  fontSize: 10.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
                title="Lock Udhaar Screen Now"
              >
                🔒
              </button>
            )}

            {embedded && (
              <a
                href="https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar/Udhaar-Tracker-Pro-Friend.apk"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '4px 8px',
                  borderRadius: 999,
                  background: palette.surfaceAlt,
                  border: `1px solid ${palette.border}`,
                  color: palette.textSub,
                  fontSize: 10.5,
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                ⬇️ Friend APK
              </a>
            )}
            <div
              onClick={toggleMinimized}
              style={{
                padding: '4px 9px',
                borderRadius: 999,
                background: isLight ? '#fef3c7' : 'rgba(245, 158, 11, 0.16)',
                color: isLight ? '#b45309' : '#fbbf24',
                fontSize: 11.5,
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              {isVaultLocked ? '🔒 Locked' : `₹${formatINR(summary.pendingTotal)}`} {minimized ? '▸' : '▾'}
            </div>
          </div>
        </div>
      </div>

      {/* 1B. OPTIONAL BIOMETRIC PRIVACY LOCK SCREEN (SHOWN ONLY WHEN LOCK IS ENABLED & LOCKED) */}
      {!minimized && biometricLockEnabled && isVaultLocked && (
        <div
          style={{
            padding: '24px 16px',
            borderRadius: 16,
            background: palette.surfaceAlt,
            border: '1.5px solid rgba(16, 185, 129, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 34 }}>🔒</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: palette.text }}>
            Udhaar Data is Biometric Locked
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: palette.textMuted, maxWidth: 280 }}>
            No one can see your Udhaar list or amounts without your fingerprint or phone lock.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
            <button
              type="button"
              onClick={() => requestBiometricAuth('unlock')}
              style={{
                padding: '10px 18px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              👆 Unlock with Fingerprint
            </button>
            <button
              type="button"
              onClick={() => requestBiometricAuth('disable')}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.surface,
                color: palette.textSub,
                fontWeight: 800,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Disable Lock
            </button>
          </div>
        </div>
      )}

      {/* 2. BODY (HIDDEN WHEN MINIMIZED OR WHEN BIOMETRIC LOCKED) */}
      {!minimized && (!biometricLockEnabled || !isVaultLocked) && (
        <>
          {/* Simple 2-Box Total Bar */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: isLight ? '#b45309' : '#fbbf24' }}>
                ⏳ Remaining to Pay
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 2 }}>
                ₹{formatINR(summary.pendingTotal)}
              </div>
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 14,
                background: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: isLight ? '#047857' : '#34d399' }}>
                ✅ Total Paid / Returned
              </div>
              <div style={{ fontSize: 18, fontWeight: 900, color: palette.text, marginTop: 2 }}>
                ₹{formatINR(summary.returnedTotal)}
              </div>
            </div>
          </div>

          {/* Simple Add Form + Universal File Upload Button */}
          <form
            onSubmit={handleAdd}
            style={{
              padding: '12px',
              borderRadius: 16,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Row 1: Name + Amount */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="👤 Friend Name"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 13.5,
                  fontWeight: 800,
                  outline: 'none',
                }}
              />
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="₹ Amount"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 13.5,
                  fontWeight: 900,
                  outline: 'none',
                }}
              />
            </div>

            {/* Row 2: When did he take? (Simple Today / Yesterday + Date & Time) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textSub }}>
                  📅 When did he take?
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { label: 'Today', iso: getTodayIso() },
                    { label: 'Yesterday', iso: getRelativeDateIso(1) },
                  ].map((chip) => {
                    const active = date === chip.iso;
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setDate(chip.iso)}
                        style={{
                          padding: '3px 9px',
                          borderRadius: 999,
                          border: active ? '1px solid #f59e0b' : `1px solid ${palette.border}`,
                          background: active ? 'rgba(245, 158, 11, 0.18)' : palette.surface,
                          color: active ? (isLight ? '#b45309' : '#fbbf24') : palette.textMuted,
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 10px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                    outline: 'none',
                  }}
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px 10px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surface,
                    color: palette.text,
                    fontSize: 12.5,
                    fontWeight: 800,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Row 3: Note + Save Button */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 8 }}>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="📝 For what? (optional)"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.text,
                  fontSize: 12.5,
                  fontWeight: 700,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                + Add Udhaar
              </button>
            </div>

            {/* Row 4: Universal File / Sheet / Screenshot Upload (Reads any Screenshot, Excel, CSV, PDF, Word, TXT & creates Udhaar persons) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*,image/*,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.tsv,.txt,.pdf,.doc,.docx,.json,.xml,.html"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImportingFile}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 12,
                border: `1px dashed ${isLight ? '#6366f1' : 'rgba(129, 140, 248, 0.5)'}`,
                background: isLight ? '#eef2ff' : 'rgba(99, 102, 241, 0.12)',
                color: isLight ? '#4338ca' : '#a5b4fc',
                fontSize: 12,
                fontWeight: 800,
                cursor: isImportingFile ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>📷</span>
              <span>
                {isImportingFile
                  ? 'Reading Screenshot / File Data...'
                  : 'Upload Screenshot / File / Sheet (Image, Excel, CSV, PDF, Word)'}
              </span>
            </button>
          </form>

          {/* Uploaded Screenshot Preview Banner */}
          {uploadedScreenshotPreview && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                background: palette.surfaceAlt,
                border: `1px solid ${palette.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                <img
                  src={uploadedScreenshotPreview.dataUrl}
                  alt="Uploaded Screenshot"
                  style={{
                    width: 48,
                    height: 48,
                    objectFit: 'cover',
                    borderRadius: 8,
                    border: `1px solid ${palette.border}`,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: palette.text }}>
                    📷 {uploadedScreenshotPreview.fileName}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted }}>
                    {uploadedScreenshotPreview.count > 0
                      ? `✅ Auto-read ${uploadedScreenshotPreview.count} person(s) from screenshot`
                      : 'Screenshot loaded — check or add person above'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUploadedScreenshotPreview(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: palette.textMuted,
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>
          )}

          {/* Imported File Confirmation Banner */}
          {lastImportSummary && (
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 12,
                background: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 800, color: isLight ? '#065f46' : '#6ee7b7' }}>
                ✅ Imported {lastImportSummary.count} person(s) from <b>{lastImportSummary.fileName}</b>
                {lastImportSummary.sheets?.length > 0 ? ` (${lastImportSummary.sheets.join(', ')})` : ''} · Total ₹
                {formatINR(lastImportSummary.totalToPay)} to pay
              </div>
              <button
                type="button"
                onClick={handleUndoLastImport}
                style={{
                  padding: '4px 9px',
                  borderRadius: 8,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: palette.textSub,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                ↩️ Undo
              </button>
            </div>
          )}

          {/* Sheet Name Filter Pills (When multiple sheets are imported) */}
          {allSheetNames.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
              <button
                type="button"
                onClick={() => setSelectedSheetFilter('ALL')}
                style={{
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: selectedSheetFilter === 'ALL' ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                  background: selectedSheetFilter === 'ALL' ? 'rgba(99, 102, 241, 0.18)' : palette.surfaceAlt,
                  color: selectedSheetFilter === 'ALL' ? (isLight ? '#4338ca' : '#a5b4fc') : palette.textMuted,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                All Sheets ({items.length})
              </button>
              {allSheetNames.map((sName) => {
                const active = selectedSheetFilter === sName;
                const count = items.filter((x) => x?.sheetName === sName).length;
                return (
                  <button
                    key={sName}
                    type="button"
                    onClick={() => setSelectedSheetFilter(sName)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: active ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                      background: active ? 'rgba(99, 102, 241, 0.18)' : palette.surfaceAlt,
                      color: active ? (isLight ? '#4338ca' : '#a5b4fc') : palette.textMuted,
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    📄 {sName} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Simple Pending / Returned Switch */}
          {items.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                type="button"
                onClick={() => setTab('pending')}
                style={{
                  padding: '8px',
                  borderRadius: 10,
                  border: tab === 'pending' ? '1px solid #f59e0b' : `1px solid ${palette.border}`,
                  background: tab === 'pending' ? 'rgba(245, 158, 11, 0.16)' : palette.surfaceAlt,
                  color: tab === 'pending' ? (isLight ? '#b45309' : '#fbbf24') : palette.textMuted,
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ⏳ Pending ({summary.pendingCount})
              </button>
              <button
                type="button"
                onClick={() => setTab('returned')}
                style={{
                  padding: '8px',
                  borderRadius: 10,
                  border: tab === 'returned' ? '1px solid #10b981' : `1px solid ${palette.border}`,
                  background: tab === 'returned' ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                  color: tab === 'returned' ? (isLight ? '#047857' : '#34d399') : palette.textMuted,
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                ✅ Returned ({summary.returnedCount})
              </button>
            </div>
          )}

          {/* Clean List of People */}
          {visibleItems.length === 0 ? (
            <div
              style={{
                padding: '14px',
                textAlign: 'center',
                color: palette.textMuted,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {items.length === 0
                ? 'No Udhaar entries yet. Add name & amount or upload a file above.'
                : tab === 'pending'
                ? '🎉 All Udhaar has been returned!'
                : 'No returned entries yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleItems.map((item) => {
                const stats = getPaymentStats(item);
                const isReturned = stats.isReturned;
                const isRecordingPay = payItemId === item.id;

                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '12px',
                      borderRadius: 14,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    {/* Top Info Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 15, fontWeight: 900, color: palette.text }}>
                            {item.person}
                          </span>
                          {item.sheetName && (
                            <span
                              style={{
                                padding: '2px 7px',
                                borderRadius: 999,
                                background: 'rgba(99, 102, 241, 0.15)',
                                color: isLight ? '#4338ca' : '#a5b4fc',
                                fontSize: 10,
                                fontWeight: 800,
                              }}
                            >
                              📄 {item.sheetName}
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                          📅 Took ₹{formatINR(stats.totalAmount)} on {formatShortDate(item.date)}
                          {item.time ? ` · ${formatTime12h(item.time)}` : ''}
                        </div>

                        {item.note && (
                          <div style={{ fontSize: 11.5, color: palette.textSub, fontWeight: 700, marginTop: 3 }}>
                            📝 {item.note}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 900,
                            color: isReturned ? '#10b981' : isLight ? '#d97706' : '#fbbf24',
                          }}
                        >
                          ₹{formatINR(isReturned ? stats.totalAmount : stats.remaining)}
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>
                          {isReturned ? '✅ Fully Paid' : '⏳ To Pay'}
                        </div>
                      </div>
                    </div>

                    {/* Payment Summary Strip: Total | Paid (How many times) | Remaining */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 6,
                        padding: '7px 10px',
                        borderRadius: 10,
                        background: palette.surface,
                        border: `1px solid ${palette.border}`,
                        fontSize: 11.5,
                        fontWeight: 800,
                      }}
                    >
                      <span style={{ color: palette.textSub }}>
                        Total: <b>₹{formatINR(stats.totalAmount)}</b>
                      </span>
                      <span style={{ color: '#10b981' }}>
                        Paid: <b>₹{formatINR(stats.totalPaid)}</b> ({stats.paidCount}{' '}
                        {stats.paidCount === 1 ? 'time' : 'times'})
                      </span>
                      <span style={{ color: isReturned ? '#10b981' : '#f59e0b' }}>
                        Balance: <b>₹{formatINR(stats.remaining)}</b>
                      </span>
                    </div>

                    {/* Payment History List: Shows each time he paid, how much, paid through & paid date */}
                    {stats.paidList.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: isLight ? '#f0fdf4' : 'rgba(16, 185, 129, 0.08)',
                          border: '1px solid rgba(16, 185, 129, 0.25)',
                        }}
                      >
                        <div style={{ fontSize: 10.5, fontWeight: 900, color: isLight ? '#047857' : '#34d399' }}>
                          💵 Payment History (Paid {stats.paidList.length}{' '}
                          {stats.paidList.length === 1 ? 'time' : 'times'}):
                        </div>
                        {stats.paidList.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 11.5,
                              fontWeight: 700,
                              color: palette.text,
                            }}
                          >
                            <span>
                              <b>#{idx + 1}</b> · Paid <b style={{ color: '#10b981' }}>₹{formatINR(p.amount)}</b> via{' '}
                              <b>{p.paidThrough || 'UPI'}</b> · 📅 {formatShortDate(p.paidDate)}
                              {p.paidTime ? ` ${formatTime12h(p.paidTime)}` : ''}
                              {p.note ? ` (${p.note})` : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemovePaymentRecord(item.id, p.id)}
                              title="Remove this payment entry"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: palette.textMuted,
                                fontSize: 11,
                                fontWeight: 900,
                                cursor: 'pointer',
                                padding: '0 4px',
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inline "Record Paid" Box (When he paid, How much he paid, Paid through, Paid date) */}
                    {isRecordingPay && (
                      <div
                        style={{
                          padding: '10px',
                          borderRadius: 12,
                          background: palette.surface,
                          border: '1.5px solid #10b981',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 900, color: '#10b981' }}>
                            💵 Record Payment from {item.person}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPayItemId(null)}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: palette.textMuted,
                              fontSize: 13,
                              fontWeight: 900,
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>

                        {/* Amount Paid + Full Balance quick chip */}
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={payAmountDraft}
                            onChange={(e) => setPayAmountDraft(e.target.value)}
                            placeholder="₹ How much he paid?"
                            style={{
                              flex: 1,
                              padding: '8px 10px',
                              borderRadius: 10,
                              border: `1px solid ${palette.border}`,
                              background: palette.surfaceAlt,
                              color: palette.text,
                              fontSize: 13,
                              fontWeight: 900,
                              outline: 'none',
                            }}
                          />
                          {stats.remaining > 0 && (
                            <button
                              type="button"
                              onClick={() => setPayAmountDraft(String(stats.remaining))}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 10,
                                border: '1px solid rgba(16, 185, 129, 0.4)',
                                background: 'rgba(16, 185, 129, 0.14)',
                                color: '#10b981',
                                fontSize: 11,
                                fontWeight: 900,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              Full ₹{formatINR(stats.remaining)}
                            </button>
                          )}
                        </div>

                        {/* Paid Through Pills (PhonePe, GPay, Paytm, Cash, UPI, Bank) */}
                        <div>
                          <div style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                            💳 Paid Through:
                          </div>
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {PAYMENT_MODES.map((mode) => {
                              const active = payThroughDraft === mode;
                              return (
                                <button
                                  key={mode}
                                  type="button"
                                  onClick={() => setPayThroughDraft(mode)}
                                  style={{
                                    padding: '4px 9px',
                                    borderRadius: 999,
                                    border: active ? '1px solid #10b981' : `1px solid ${palette.border}`,
                                    background: active ? 'rgba(16, 185, 129, 0.18)' : palette.surfaceAlt,
                                    color: active ? '#10b981' : palette.textSub,
                                    fontSize: 11,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {mode}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Paid Date & Time */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 10.5, fontWeight: 800, color: palette.textMuted }}>
                              📅 Paid Date:
                            </span>
                            <div style={{ display: 'flex', gap: 5 }}>
                              {[
                                { label: 'Today', iso: getTodayIso() },
                                { label: 'Yesterday', iso: getRelativeDateIso(1) },
                              ].map((c) => (
                                <button
                                  key={c.label}
                                  type="button"
                                  onClick={() => setPayDateDraft(c.iso)}
                                  style={{
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    border: payDateDraft === c.iso ? '1px solid #10b981' : `1px solid ${palette.border}`,
                                    background: payDateDraft === c.iso ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                                    color: payDateDraft === c.iso ? '#10b981' : palette.textMuted,
                                    fontSize: 10.5,
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 6 }}>
                            <input
                              type="date"
                              value={payDateDraft}
                              onChange={(e) => setPayDateDraft(e.target.value)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '7px 8px',
                                borderRadius: 8,
                                border: `1px solid ${palette.border}`,
                                background: palette.surfaceAlt,
                                color: palette.text,
                                fontSize: 12,
                                fontWeight: 800,
                              }}
                            />
                            <input
                              type="time"
                              value={payTimeDraft}
                              onChange={(e) => setPayTimeDraft(e.target.value)}
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                padding: '7px 8px',
                                borderRadius: 8,
                                border: `1px solid ${palette.border}`,
                                background: palette.surfaceAlt,
                                color: palette.text,
                                fontSize: 12,
                                fontWeight: 800,
                              }}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSavePayment(item)}
                          style={{
                            padding: '9px 12px',
                            borderRadius: 10,
                            border: 'none',
                            background: '#10b981',
                            color: '#ffffff',
                            fontWeight: 900,
                            fontSize: 12.5,
                            cursor: 'pointer',
                          }}
                        >
                          ✅ Save Payment (₹{formatINR(payAmountDraft || 0)} via {payThroughDraft})
                        </button>
                      </div>
                    )}

                    {/* Clean 4-Button Action Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.8fr 0.9fr', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => openRecordPayment(item)}
                        style={{
                          padding: '8px 6px',
                          borderRadius: 10,
                          border: '1px solid rgba(16, 185, 129, 0.45)',
                          background: isRecordingPay ? '#10b981' : 'rgba(16, 185, 129, 0.14)',
                          color: isRecordingPay ? '#ffffff' : '#10b981',
                          fontWeight: 900,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        💵 + Paid
                      </button>

                      <button
                        type="button"
                        onClick={() => toggleStatus(item.id)}
                        style={{
                          padding: '8px 6px',
                          borderRadius: 10,
                          border: 'none',
                          background: isReturned ? palette.surface : '#10b981',
                          color: isReturned ? palette.textSub : '#ffffff',
                          fontWeight: 900,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        {isReturned ? '↩️ Pending' : '✅ Full Paid'}
                      </button>

                      <button
                        type="button"
                        onClick={() => setEditItem({ ...item })}
                        style={{
                          padding: '8px 6px',
                          borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: palette.text,
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        ✏️ Edit
                      </button>

                      <button
                        type="button"
                        onClick={() => sendWhatsAppReminder(item)}
                        style={{
                          padding: '8px 6px',
                          borderRadius: 10,
                          border: `1px solid ${palette.border}`,
                          background: palette.surface,
                          color: '#10b981',
                          fontWeight: 800,
                          fontSize: 11.5,
                          cursor: 'pointer',
                        }}
                      >
                        💬 Remind
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* SIMPLE CLEAN EDIT POPUP */}
      {editItem && (
        <div
          onClick={() => setEditItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveEdit}
            style={{
              width: '100%',
              maxWidth: 380,
              borderRadius: 20,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              color: palette.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>✏️ Edit Udhaar</div>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: palette.textMuted,
                  fontSize: 18,
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Friend Name
              </div>
              <input
                type="text"
                value={editItem.person || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, person: e.target.value }))}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 14,
                  fontWeight: 800,
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Total Amount (₹)
                </div>
                <input
                  type="number"
                  value={editItem.amount ?? ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, amount: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 14,
                    fontWeight: 900,
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Sheet / Group Name
                </div>
                <input
                  type="text"
                  value={editItem.sheetName || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, sheetName: e.target.value }))}
                  placeholder="Optional"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Date Taken
                </div>
                <input
                  type="date"
                  value={editItem.date || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, date: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Time Taken
                </div>
                <input
                  type="time"
                  value={editItem.time || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, time: e.target.value }))}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '9px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Note / Reason
              </div>
              <input
                type="text"
                value={editItem.note || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, note: e.target.value }))}
                placeholder="For what?"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                WhatsApp Phone (optional)
              </div>
              <input
                type="tel"
                value={editItem.phone || ''}
                onChange={(e) => setEditItem((p) => ({ ...p, phone: e.target.value }))}
                placeholder="10-digit mobile number"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => deleteEntry(editItem.id)}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  fontWeight: 900,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                🗑️ Delete
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                ✓ Save Changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return cardContent;
  }

  // Standalone APK wrapper for friend (Uses separate ota-udhaar server)
  return (
    <div
      style={{
        minHeight: '100vh',
        background: palette.bg,
        color: palette.text,
        padding: '14px 12px 48px',
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Clean Standalone Top Bar with Top-Right "Created by Pattan Yasin" Badge & Dedicated Udhaar OTA Button */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 16,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>🤝 Udhaar Tracker</div>
              <div style={{ fontSize: 10.5, color: palette.textMuted, fontWeight: 700 }}>
                v{udhaarOtaVersion} · Udhaar OTA
              </div>
            </div>

            {/* Top-Right Corner "Created by Pattan Yasin" Badge */}
            <div
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                background: isLight
                  ? 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)'
                  : 'linear-gradient(135deg, rgba(99, 102, 241, 0.22) 0%, rgba(16, 185, 129, 0.22) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.45)',
                color: isLight ? '#3730a3' : '#a5b4fc',
                fontSize: 11,
                fontWeight: 900,
                whiteSpace: 'nowrap',
              }}
            >
              ✨ Created by Pattan Yasin
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={toggleBiometricLockSetting}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: biometricLockEnabled ? '1px solid #10b981' : `1px solid ${palette.border}`,
                  background: biometricLockEnabled ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                  color: biometricLockEnabled ? '#10b981' : palette.text,
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {biometricLockEnabled ? '🔒 Lock: ON' : '🔓 Lock: OFF'}
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
                title="Upload Screenshot / Excel / CSV / PDF / Word / TXT"
              >
                📷 Upload File / Screenshot
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={applyUdhaarOtaUpdate}
                disabled={udhaarOtaBusy}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: availableUdhaarOta ? 'none' : `1px solid ${palette.border}`,
                  background: availableUdhaarOta ? '#10b981' : palette.surfaceAlt,
                  color: availableUdhaarOta ? '#ffffff' : palette.text,
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: udhaarOtaBusy ? 'wait' : 'pointer',
                }}
              >
                {udhaarOtaBusy ? '⏳...' : availableUdhaarOta ? `🚀 Update v${availableUdhaarOta.version}` : '🔄 Update'}
              </button>

              <button
                type="button"
                onClick={() => setThemeLight((v) => !v)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                {isLight ? '🌙' : '☀️'}
              </button>
            </div>
          </div>
        </div>

        {/* Dedicated Udhaar OTA Update Banner */}
        {availableUdhaarOta && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 14,
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 800 }}>
              🚀 New Udhaar Update v{availableUdhaarOta.version}: {availableUdhaarOta.notes}
            </div>
            <button
              type="button"
              onClick={applyUdhaarOtaUpdate}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: 'none',
                background: '#10b981',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 11.5,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Update Now
            </button>
          </div>
        )}

        {toastMsg && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              background: '#10b981',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 800,
              textAlign: 'center',
            }}
          >
            {toastMsg}
          </div>
        )}

        {cardContent}
      </div>
    </div>
  );
}
