import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import JSZip from 'jszip';

const UDHAAR_STORAGE_KEY = 'yasin_udhaar_returnable_ledger_v1';
const UDHAAR_BIOMETRIC_LOCK_KEY = 'yasin_udhaar_biometric_lock_enabled_v1';
const UDHAAR_OTA_VERSION_KEY = 'udhaar_standalone_ota_version_v1';
const UDHAAR_OTA_BUILD_ID_KEY = 'udhaar_standalone_ota_build_id_v1';
const BUILTIN_UDHAAR_OTA_VERSION = '1.0.8';
const BUILTIN_UDHAAR_OTA_BUILD_ID = 'udhaar_ota_1_0_8_play_protect_clean_manifest_no_notif_service';

// Separate Dedicated Udhaar OTA Server Endpoints (Strictly isolated from Salary & OT OTA server)
const UDHAAR_OTA_BASES = [
  'https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar',
  'https://cdn.jsdelivr.net/gh/Yasin144/female-presentator@main/ota-udhaar',
];

// Direct Download URL for the Standalone Udhaar APK (Play-Protect Safe Signed Release APK)
const STANDALONE_UDHAAR_APK_URL =
  'https://raw.githubusercontent.com/Yasin144/female-presentator/main/ota-udhaar/Udhaar-Tracker-Pro-Friend.apk';

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
        note: '',
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
// UNIVERSAL FILE, SHEET & SCREENSHOT PARSER
// ═══════════════════════════════════════════════════════════════════════════
function parseAmountNumber(rawVal) {
  if (typeof rawVal === 'number' && Number.isFinite(rawVal)) return Math.abs(rawVal);
  if (rawVal === null || rawVal === undefined) return NaN;
  const str = String(rawVal)
    .replace(/(?:Rs\.?|INR|₹|\$)/gi, '')
    .replace(/,/g, '')
    .trim();
  if (!str) return NaN;
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
          if (numCells.length >= 3 && Math.abs(numCells[0] - numCells[1] - numCells[2]) < 2) {
            paidAmt = numCells[1];
          }
        }
      }
    }

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

  const freeResults = [];
  for (const rawLine of lines) {
    const cleanLine = rawLine.replace(/^\s*(?:\d+[.)]\s*|[-*•]\s*)/, '').trim();
    if (!cleanLine || cleanLine.length > 180) continue;

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

    const mainPart = cleanLine.replace(/\b(?:paid|returned|given\s*back)\s*(?:rs\.?|inr|₹)?\s*[\d,]+(?:\.\d{1,2})?.*$/i, '').trim();

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

  if (freeResults.length === 0 && lines.length >= 2) {
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
          note: 'Read from Screenshot',
          sheetName: cleanSheet,
        });
      }
    }

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
          i++;
        }
      }
    }
  }

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

async function parseZipBasedDocument(arrayBuffer, fileName) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const results = [];

  const workbookFile = zip.file('xl/workbook.xml');
  if (workbookFile) {
    const parser = new DOMParser();
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

  const wordFile = zip.file('word/document.xml');
  if (wordFile) {
    const wordXml = await wordFile.async('string');
    const parser = new DOMParser();
    const wDoc = parser.parseFromString(wordXml, 'application/xml');
    const sheetLabel = cleanFileBaseName(fileName) || 'Word Doc';

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

async function extractScreenshotText(file) {
  const { dataUrl, imgElement } = await imageFileToCompressedDataUrl(file);

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

async function extractUniversalFilePeople(file) {
  const fileName = file?.name || 'Uploaded File';
  const baseSheetName = cleanFileBaseName(fileName) || 'Imported Sheet';
  const isImageFile =
    /^image\//i.test(String(file?.type || '')) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(fileName);

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

  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const zipRes = await parseZipBasedDocument(arrayBuffer, fileName);
      if (zipRes.length > 0) return { people: zipRes, isScreenshot: false };
    } catch (_) {}
  }

  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);

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
          border: 'rgba(148, 163, 184, 0.18)',
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

  // Collapsible Section States
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem('yasin_udhaar_simple_minimized_v1') === '1';
    } catch (_) {
      return false;
    }
  });
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const [expandedPersonIds, setExpandedPersonIds] = useState(() => ({}));
  const [allPersonsExpanded, setAllPersonsExpanded] = useState(false);
  const [whatsAppPhonePromptItem, setWhatsAppPhonePromptItem] = useState(null);
  const [whatsAppPhoneDraft, setWhatsAppPhoneDraft] = useState('');
  const [inlinePhoneDrafts, setInlinePhoneDrafts] = useState(() => ({}));

  const togglePersonExpanded = useCallback((personId) => {
    setExpandedPersonIds((prev) => ({
      ...prev,
      [personId]: !prev[personId],
    }));
  }, []);

  const focusAndExpandPerson = useCallback((personId) => {
    setExpandedPersonIds((prev) => ({
      ...prev,
      [personId]: !prev[personId],
    }));
    setTimeout(() => {
      try {
        const el = document.getElementById(`udhaar-member-card-${personId}`);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (_) {}
    }, 80);
  }, []);

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

  // Add Udhaar Modal State (Closed by default so the main screen is 100% clean!)
  const [showAddModal, setShowAddModal] = useState(false);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => getTodayIso());
  const [time, setTime] = useState(() => getCurrentTimeHHMM());
  const [note, setNote] = useState('');
  const [phone, setPhone] = useState('');

  // Search & Filter: 'pending' | 'returned'
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState('pending');
  const [selectedSheetFilter, setSelectedSheetFilter] = useState('ALL');

  // Dedicated "Record Payment" Modal State
  const [paymentModalItem, setPaymentModalItem] = useState(null);
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

  // Biometric Lock State (Enabled by default on Android hardware unless user explicitly disabled with '0')
  const [biometricLockEnabled, setBiometricLockEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem(UDHAAR_BIOMETRIC_LOCK_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
      return typeof window !== 'undefined' && Boolean(window.PattanBiometric);
    } catch (_) {
      return false;
    }
  });
  const [isVaultLocked, setIsVaultLocked] = useState(() => {
    try {
      const saved = localStorage.getItem(UDHAAR_BIOMETRIC_LOCK_KEY);
      if (saved === '0') return false;
      if (saved === '1') return true;
      return typeof window !== 'undefined' && Boolean(window.PattanBiometric);
    } catch (_) {
      return false;
    }
  });
  const pendingBioIntentRef = useRef('unlock');
  const autoPromptTriggeredRef = useRef(false);

  useEffect(() => {
    if (embedded) return undefined;
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
  }, [embedded, notify]);

  useEffect(() => {
    if (embedded || !biometricLockEnabled) return undefined;
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        autoPromptTriggeredRef.current = false;
        setIsVaultLocked(true);
      } else if (document.visibilityState === 'visible') {
        autoPromptTriggeredRef.current = false;
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [embedded, biometricLockEnabled]);

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
          intent === 'disable' ? 'Disable Udhaar Biometric Lock' : 'Unlock Udhaar Book',
          'Scan fingerprint, face, or phone screen lock to open Udhaar Book'
        );
        return;
      }
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

  // Automatically ask for biometric authentication when opening the Udhaar app (same as Yasin Salary OT App)
  useEffect(() => {
    if (embedded || !biometricLockEnabled || !isVaultLocked) return undefined;
    if (autoPromptTriggeredRef.current) return undefined;
    autoPromptTriggeredRef.current = true;
    const timer = setTimeout(() => {
      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.authenticate === 'function'
      ) {
        requestBiometricAuth('unlock');
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [embedded, biometricLockEnabled, isVaultLocked, requestBiometricAuth]);

  const toggleBiometricLockSetting = useCallback(() => {
    if (!biometricLockEnabled) {
      setBiometricLockEnabled(true);
      setIsVaultLocked(false);
      try {
        localStorage.setItem(UDHAAR_BIOMETRIC_LOCK_KEY, '1');
      } catch (_) {}
      notify('🔒 Biometric Lock Enabled!');
    } else {
      requestBiometricAuth('disable');
    }
  }, [biometricLockEnabled, notify, requestBiometricAuth]);

  // Edit Modal State
  const [editItem, setEditItem] = useState(null);

  const activeExternalDraft = externalDraft || externalDraftRequest;
  useEffect(() => {
    if (!embedded && activeExternalDraft && typeof activeExternalDraft === 'object') {
      setMinimized(false);
      setPerson(activeExternalDraft.person || '');
      setAmount(activeExternalDraft.amount ? String(activeExternalDraft.amount) : '');
      setDate(activeExternalDraft.tookDate || activeExternalDraft.date || getTodayIso());
      setTime(activeExternalDraft.tookTime || activeExternalDraft.time || getCurrentTimeHHMM());
      setNote(activeExternalDraft.note || '');
      setShowAddModal(true);
      if (typeof onClearExternalDraft === 'function') {
        onClearExternalDraft();
      }
    }
  }, [embedded, activeExternalDraft, onClearExternalDraft]);

  const handleDownloadStandaloneApk = () => {
    const downloadUrl = `${STANDALONE_UDHAAR_APK_URL}?t=${Date.now()}`;
    try {
      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.launchUpiUri === 'function'
      ) {
        window.PattanBiometric.launchUpiUri(downloadUrl);
        notify('⬇️ Downloading Standalone Udhaar APK (Latest Update)...');
        return;
      }
    } catch (_) {}
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    notify('⬇️ Downloading Standalone Udhaar APK (Latest Update)...');
  };

  const handleShareApkOnWhatsApp = () => {
    const text = `🤝 *Udhaar Book App (Created by Pattan Yasin)*\nDownload the latest Play-Protect-safe Standalone Udhaar APK here:\n${STANDALONE_UDHAAR_APK_URL}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // WHEN EMBEDDED INSIDE SALARY & OT APP:
  // Render a 100% Mobile-Responsive APK Download Card!
  // All Udhaar updates go strictly to the downloaded Standalone Udhaar APK & ota-udhaar/ server!
  // ═══════════════════════════════════════════════════════════════════════════
  if (embedded) {
    return (
      <div
        style={{
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          borderRadius: 18,
          background: palette.surface,
          border: `1px solid ${palette.border}`,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          onClick={toggleMinimized}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            cursor: 'pointer',
            userSelect: 'none',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 180px' }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.16)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 17,
                flexShrink: 0,
              }}
            >
              🤝
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 900,
                  color: palette.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Udhaar Tracker App {minimized ? '▸' : '▾'}
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: palette.textMuted,
                  fontWeight: 700,
                  marginTop: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                Separate Standalone APK · Created by Pattan Yasin
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleDownloadStandaloneApk();
            }}
            style={{
              padding: '7px 11px',
              borderRadius: 10,
              border: 'none',
              background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
              color: '#ffffff',
              fontSize: 11.5,
              fontWeight: 900,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            ⬇️ Download APK
          </button>
        </div>

        {!minimized && (
          <div
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px',
              borderRadius: 14,
              background: palette.surfaceAlt,
              border: `1px solid ${palette.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 11.5, fontWeight: 700, color: palette.textSub, lineHeight: 1.45, wordBreak: 'break-word' }}>
              All Udhaar Book updates (Biometric Lock on Open, 50+ Members Directory, Direct WhatsApp Share &amp; Inside Scroller) are delivered strictly inside the <b>Standalone Udhaar APK</b>.
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                gap: 8,
                width: '100%',
              }}
            >
              <button
                type="button"
                onClick={handleDownloadStandaloneApk}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 10px',
                  borderRadius: 11,
                  border: 'none',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span>⬇️</span>
                <span>Download Udhaar APK</span>
              </button>

              <button
                type="button"
                onClick={handleShareApkOnWhatsApp}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 10px',
                  borderRadius: 11,
                  border: `1px solid ${palette.border}`,
                  background: palette.surface,
                  color: '#10b981',
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                }}
              >
                <span>💬</span>
                <span>Share APK on WhatsApp</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STANDALONE UDHAAR APK LOGIC & HANDLERS (embedded === false)
  // ═══════════════════════════════════════════════════════════════════════════
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
    setShowAddModal(false);
    setTab('pending');
    notify(`✅ Saved ₹${formatINR(numAmt)} for ${cleanName}`);
  };

  const openRecordPaymentModal = (item) => {
    const stats = getPaymentStats(item);
    setPaymentModalItem(item);
    setPayAmountDraft(stats.remaining > 0 ? String(stats.remaining) : '');
    setPayThroughDraft('PhonePe');
    setPayDateDraft(getTodayIso());
    setPayTimeDraft(getCurrentTimeHHMM());
    setPayNoteDraft('');
  };

  const handleSavePayment = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!paymentModalItem) return;
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
        if (entry.id !== paymentModalItem.id) return entry;
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

    setPaymentModalItem(null);
    setPayAmountDraft('');
    setPayNoteDraft('');
    notify(`✅ Recorded ₹${formatINR(paidNum)} paid via ${payThroughDraft}`);
  };

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
          setShowAddModal(true);
          notify('📷 Screenshot attached! Enter Name & Amount.');
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
      notify(`✅ Added ${newEntries.length} person(s) from ${extracted?.isScreenshot ? 'Screenshot' : file.name}!`);
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

  const savePersonPhone = useCallback(
    (itemId, rawPhone) => {
      const cleanPhone = String(rawPhone || '').replace(/[^0-9+]/g, '');
      saveItems((prev) =>
        prev.map((entry) => (entry.id === itemId ? { ...entry, phone: cleanPhone } : entry))
      );
      return cleanPhone;
    },
    [saveItems]
  );

  const buildPersonWhatsAppStatement = useCallback((item) => {
    const stats = getPaymentStats(item);
    const dateLabel = `${formatShortDate(item.date)}${item.time ? ` at ${formatTime12h(item.time)}` : ''}`;
    const lines = [
      `🤝 *Udhaar Details — ${item.person}*`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `💰 *Total Taken:* ₹${formatINR(stats.totalAmount)}`,
      `📅 *When Taken:* ${dateLabel}`,
    ];
    if (item.note) {
      lines.push(`📝 *Reason / Note:* ${item.note}`);
    }
    if (stats.paidList.length > 0) {
      lines.push(``);
      lines.push(`✅ *Payment History (${stats.paidList.length}x Paid — ₹${formatINR(stats.totalPaid)}):*`);
      stats.paidList.forEach((p, idx) => {
        lines.push(
          `  ${idx + 1}. ₹${formatINR(p.amount)} via ${p.paidThrough || 'UPI'} (${formatShortDate(p.paidDate)}${
            p.paidTime ? ` ${formatTime12h(p.paidTime)}` : ''
          })`
        );
      });
    }
    lines.push(`━━━━━━━━━━━━━━━━━━━━`);
    if (stats.isReturned || stats.remaining <= 0) {
      lines.push(`🎉 *Balance Left:* ₹0 (Fully Settled ✅)`);
    } else {
      lines.push(`⏳ *Balance Left to Pay:* *₹${formatINR(stats.remaining)}*`);
    }
    return lines.join('\n');
  }, []);

  const launchWhatsAppWithTextAndPhone = useCallback((rawPhone, msg) => {
    const digits = String(rawPhone || '').replace(/[^0-9]/g, '');
    const phoneParam = digits.length === 10 ? `91${digits}` : digits.length > 10 ? digits : '';
    try {
      if (
        typeof window !== 'undefined' &&
        window.PattanBiometric &&
        typeof window.PattanBiometric.sendWhatsAppMessageToNumber === 'function'
      ) {
        window.PattanBiometric.sendWhatsAppMessageToNumber(phoneParam || 'PICK_CONTACT', msg);
        return;
      }
    } catch (_) {}
    const url = phoneParam
      ? `https://wa.me/${phoneParam}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const sendWhatsAppReminder = useCallback(
    (item, overridePhone) => {
      if (!item) return;
      const candidatePhone = overridePhone !== undefined ? overridePhone : item.phone;
      const digits = String(candidatePhone || '').replace(/[^0-9]/g, '');
      if (digits.length < 10 && overridePhone === undefined) {
        setWhatsAppPhonePromptItem(item);
        setWhatsAppPhoneDraft(item.phone || '');
        return;
      }
      const msg = buildPersonWhatsAppStatement(item);
      launchWhatsAppWithTextAndPhone(digits, msg);
    },
    [buildPersonWhatsAppStatement, launchWhatsAppWithTextAndPhone]
  );

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

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qNum = q.replace(/^#/, '');
    return items.filter((i, idx) => {
      if (!i) return false;
      if (selectedSheetFilter !== 'ALL' && i.sheetName !== selectedSheetFilter) return false;
      const stats = getPaymentStats(i);
      const matchesTab = tab === 'pending' ? !stats.isReturned : stats.isReturned;
      if (!matchesTab) return false;
      if (!q) return true;
      const haystack = `${idx + 1} #${idx + 1} ${i.person || ''} ${i.phone || ''} ${i.note || ''} ${i.sheetName || ''}`.toLowerCase();
      return haystack.includes(q) || (qNum && String(idx + 1) === qNum);
    });
  }, [items, tab, selectedSheetFilter, searchQuery]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STANDALONE UDHAAR APK FULL-SCREEN LAYOUT (CLEAN, STRUCTURED, ZERO CONFUSION)
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div
      style={{
        minHeight: '100vh',
        background: palette.bg,
        color: palette.text,
        padding: '14px 12px 56px',
        fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      {/* Hidden File Input for Universal Sheet / Screenshot Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="*/*,image/*,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.tsv,.txt,.pdf,.doc,.docx,.json,.xml,.html"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* ═══════════════════════════════════════════════════════════════════
            1. TOP APP BAR — "Created by Pattan Yasin" on Top-Right Corner
           ═══════════════════════════════════════════════════════════════════ */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 18,
            background: palette.surface,
            border: `1px solid ${palette.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                fontWeight: 900,
                flexShrink: 0,
              }}
            >
              🤝
            </div>
            <div>
              <div style={{ fontSize: 16.5, fontWeight: 900, color: palette.text, lineHeight: 1.15 }}>
                Udhaar Book
              </div>
              <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                v{udhaarOtaVersion} · Standalone App
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
            <div
              style={{
                padding: '3px 9px',
                borderRadius: 999,
                background: isLight ? '#eef2ff' : 'rgba(99, 102, 241, 0.16)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                color: isLight ? '#4338ca' : '#a5b4fc',
                fontSize: 10.5,
                fontWeight: 900,
                whiteSpace: 'nowrap',
              }}
            >
              ✨ Created by Pattan Yasin
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={applyUdhaarOtaUpdate}
                disabled={udhaarOtaBusy}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: availableUdhaarOta ? 'none' : `1px solid ${palette.border}`,
                  background: availableUdhaarOta ? '#10b981' : palette.surfaceAlt,
                  color: availableUdhaarOta ? '#ffffff' : palette.textSub,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: udhaarOtaBusy ? 'wait' : 'pointer',
                }}
              >
                {udhaarOtaBusy
                  ? '⏳...'
                  : availableUdhaarOta
                  ? `🚀 Update v${availableUdhaarOta.version}`
                  : '🔄 Check Update'}
              </button>

              <button
                type="button"
                onClick={toggleBiometricLockSetting}
                style={{
                  padding: '5px 9px',
                  borderRadius: 8,
                  border: biometricLockEnabled
                    ? '1px solid rgba(16, 185, 129, 0.55)'
                    : `1px solid ${palette.border}`,
                  background: biometricLockEnabled
                    ? 'rgba(16, 185, 129, 0.16)'
                    : palette.surfaceAlt,
                  color: biometricLockEnabled ? '#10b981' : palette.textMuted,
                  fontSize: 12,
                  fontWeight: 900,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={
                  biometricLockEnabled
                    ? 'Biometric App Lock ON (Tap to Disable)'
                    : 'Biometric App Lock OFF (Tap to Enable)'
                }
              >
                {biometricLockEnabled ? '🔒' : '🔓'}
              </button>

              <button
                type="button"
                onClick={() => setThemeLight((v) => !v)}
                style={{
                  padding: '5px 9px',
                  borderRadius: 8,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 11.5,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
                title="Switch Light / Dark Mode"
              >
                {isLight ? '🌙' : '☀️'}
              </button>
            </div>
          </div>
        </div>

        {/* Toast Notification Banner */}
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

        {/* IF LOCKED: Show Biometric Scanner Lock Screen (Auto-triggers Android Biometric Prompt on Open) */}
        {biometricLockEnabled && isVaultLocked ? (
          <div
            style={{
              padding: '38px 20px',
              borderRadius: 22,
              background: palette.surface,
              border: '1.5px solid rgba(16, 185, 129, 0.45)',
              boxShadow: '0 12px 32px rgba(16, 185, 129, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: 14,
            }}
          >
            <div
              onClick={() => requestBiometricAuth('unlock')}
              style={{
                width: 78,
                height: 78,
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.14)',
                border: '2px solid #10b981',
                boxShadow: '0 0 24px rgba(16, 185, 129, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 38,
                cursor: 'pointer',
              }}
              title="Tap to Scan Fingerprint"
            >
              🫆
            </div>
            <div style={{ fontSize: 19, fontWeight: 900, color: palette.text }}>
              Unlock Udhaar Book
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: palette.textMuted, maxWidth: 280, lineHeight: 1.45 }}>
              Scan your fingerprint, face, or phone screen lock to view your private Udhaar records.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => requestBiometricAuth('unlock')}
                style={{
                  padding: '12px 22px',
                  borderRadius: 13,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 14,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                }}
              >
                👆 Scan Fingerprint / Unlock
              </button>
              <button
                type="button"
                onClick={() => requestBiometricAuth('disable')}
                style={{
                  padding: '12px 15px',
                  borderRadius: 13,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
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
        ) : (
          <>
            {/* ═══════════════════════════════════════════════════════════════
                3. SUMMARY TOTALS SECTION (Tap Header to Minimize / Maximize)
               ═══════════════════════════════════════════════════════════════ */}
            <div
              style={{
                borderRadius: 18,
                background: palette.surface,
                border: `1px solid ${palette.border}`,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                onClick={() => setSummaryCollapsed((v) => !v)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 900, color: palette.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  📊 Total Summary {summaryCollapsed ? '▸' : '▾'}
                </span>
                <span style={{ fontSize: 12, fontWeight: 900, color: isLight ? '#d97706' : '#fbbf24' }}>
                  Pending: ₹{formatINR(summary.pendingTotal)}
                </span>
              </div>

              {!summaryCollapsed && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div
                    style={{
                      padding: '14px 12px',
                      borderRadius: 14,
                      background: isLight ? '#fffbeb' : 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 900, color: isLight ? '#b45309' : '#fbbf24', textTransform: 'uppercase' }}>
                      ⏳ You Will Get
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: isLight ? '#d97706' : '#fbbf24', marginTop: 4 }}>
                      ₹{formatINR(summary.pendingTotal)}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted, marginTop: 2 }}>
                      {summary.pendingCount} {summary.pendingCount === 1 ? 'Person' : 'People'} Pending
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '14px 12px',
                      borderRadius: 14,
                      background: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.12)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 900, color: '#10b981', textTransform: 'uppercase' }}>
                      ✅ Received Back
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#10b981', marginTop: 4 }}>
                      ₹{formatINR(summary.returnedTotal)}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: palette.textMuted, marginTop: 2 }}>
                      {summary.returnedCount} Fully Settled
                    </div>
                  </div>
                </div>
              )}

              {/* 2 Primary Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  style={{
                    padding: '13px 12px',
                    borderRadius: 14,
                    border: 'none',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                    color: '#ffffff',
                    fontWeight: 900,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span>➕</span>
                  <span>Add Udhaar</span>
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImportingFile}
                  style={{
                    padding: '13px 10px',
                    borderRadius: 14,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontWeight: 800,
                    fontSize: 12.5,
                    cursor: isImportingFile ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <span>📂</span>
                  <span>{isImportingFile ? 'Reading...' : 'Upload File / Photo'}</span>
                </button>
              </div>

              {lastImportSummary && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 12,
                    background: isLight ? '#ecfdf5' : 'rgba(16, 185, 129, 0.14)',
                    border: '1px solid rgba(16, 185, 129, 0.35)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: isLight ? '#065f46' : '#6ee7b7' }}>
                    ✅ Imported {lastImportSummary.count} person(s) from <b>{lastImportSummary.fileName}</b> (₹
                    {formatINR(lastImportSummary.totalToPay)})
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
                    Undo
                  </button>
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════════════════════
                4. PEOPLE LEDGER SECTION (50+ Members Directory + Search + Tap Name to Maximize)
               ═══════════════════════════════════════════════════════════════ */}
            <div
              style={{
                borderRadius: 18,
                background: palette.surface,
                border: `1px solid ${palette.border}`,
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div
                onClick={() => setListCollapsed((v) => !v)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <span style={{ fontSize: 13.5, fontWeight: 900, color: palette.text }}>
                  👥 People Udhaar List ({items.length}) {listCollapsed ? '▸' : '▾'}
                </span>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted }}>
                  {listCollapsed ? 'Tap to show all names' : 'Tap to minimize'}
                </span>
              </div>

              {!listCollapsed && (
                <>
                  {/* Sheet Filter Chips (If files/sheets were uploaded) */}
                  {allSheetNames.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
                      <button
                        type="button"
                        onClick={() => setSelectedSheetFilter('ALL')}
                        style={{
                          padding: '5px 11px',
                          borderRadius: 999,
                          border: selectedSheetFilter === 'ALL' ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                          background: selectedSheetFilter === 'ALL' ? 'rgba(99, 102, 241, 0.16)' : palette.surfaceAlt,
                          color: selectedSheetFilter === 'ALL' ? (isLight ? '#4338ca' : '#a5b4fc') : palette.textMuted,
                          fontSize: 11.5,
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
                              padding: '5px 11px',
                              borderRadius: 999,
                              border: active ? '1px solid #6366f1' : `1px solid ${palette.border}`,
                              background: active ? 'rgba(99, 102, 241, 0.16)' : palette.surfaceAlt,
                              color: active ? (isLight ? '#4338ca' : '#a5b4fc') : palette.textMuted,
                              fontSize: 11.5,
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

                  {/* Clean 2-Tab Switch: Pending vs Settled */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 6,
                      padding: 4,
                      borderRadius: 12,
                      background: palette.surfaceAlt,
                      border: `1px solid ${palette.border}`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setTab('pending')}
                      style={{
                        padding: '9px',
                        borderRadius: 9,
                        border: 'none',
                        background: tab === 'pending' ? palette.surface : 'transparent',
                        color: tab === 'pending' ? (isLight ? '#d97706' : '#fbbf24') : palette.textMuted,
                        fontSize: 12.5,
                        fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: tab === 'pending' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                      }}
                    >
                      ⏳ Pending ({summary.pendingCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('returned')}
                      style={{
                        padding: '9px',
                        borderRadius: 9,
                        border: 'none',
                        background: tab === 'returned' ? palette.surface : 'transparent',
                        color: tab === 'returned' ? '#10b981' : palette.textMuted,
                        fontSize: 12.5,
                        fontWeight: 900,
                        cursor: 'pointer',
                        boxShadow: tab === 'returned' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                      }}
                    >
                      ✅ Settled ({summary.returnedCount})
                    </button>
                  </div>

                  {/* Search Input (Always visible when 1+ items exist so user can search across 50+ members) */}
                  {items.length >= 1 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`🔍 Search name, #number (1-${items.length}), mobile, or note...`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          boxSizing: 'border-box',
                          padding: '9px 12px',
                          borderRadius: 12,
                          border: `1px solid ${palette.border}`,
                          background: palette.surfaceAlt,
                          color: palette.text,
                          fontSize: 12.5,
                          fontWeight: 700,
                          outline: 'none',
                        }}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          style={{
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: `1px solid ${palette.border}`,
                            background: palette.surfaceAlt,
                            color: palette.textMuted,
                            fontSize: 11.5,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}

                  {/* ALL MEMBERS NUMBERED DIRECTORY (With Inside Scroller for 50+ Members — Tap any Name to Maximize Detail) */}
                  {visibleItems.length > 0 && (
                    <div
                      style={{
                        padding: '10px',
                        borderRadius: 14,
                        background: palette.surfaceAlt,
                        border: `1px solid ${palette.border}`,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: palette.textMuted, textTransform: 'uppercase' }}>
                          🔢 All Members ({visibleItems.length}) · Tap Name to Open Detail
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextAll = !allPersonsExpanded;
                            setAllPersonsExpanded(nextAll);
                            const nextMap = {};
                            if (nextAll) {
                              visibleItems.forEach((it) => {
                                nextMap[it.id] = true;
                              });
                            }
                            setExpandedPersonIds(nextMap);
                          }}
                          style={{
                            padding: '3px 8px',
                            borderRadius: 7,
                            border: `1px solid ${palette.border}`,
                            background: palette.surface,
                            color: palette.textSub,
                            fontSize: 10.5,
                            fontWeight: 800,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {allPersonsExpanded ? 'Minimize All ▴' : 'Expand All ▾'}
                        </button>
                      </div>

                      <div
                        style={{
                          maxHeight: 150,
                          overflowY: 'auto',
                          WebkitOverflowScrolling: 'touch',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 6,
                          paddingRight: 2,
                        }}
                      >
                        {visibleItems.map((item, idx) => {
                          const stats = getPaymentStats(item);
                          const isExpanded = Boolean(allPersonsExpanded || expandedPersonIds[item.id]);
                          return (
                            <button
                              key={`dir_${item.id}`}
                              type="button"
                              onClick={() => {
                                if (allPersonsExpanded) setAllPersonsExpanded(false);
                                focusAndExpandPerson(item.id);
                              }}
                              style={{
                                padding: '5px 10px',
                                borderRadius: 999,
                                border: isExpanded
                                  ? '1.5px solid #f59e0b'
                                  : `1px solid ${palette.border}`,
                                background: isExpanded
                                  ? isLight
                                    ? '#fffbeb'
                                    : 'rgba(245, 158, 11, 0.18)'
                                  : palette.surface,
                                color: isExpanded
                                  ? isLight
                                    ? '#b45309'
                                    : '#fbbf24'
                                  : palette.text,
                                fontSize: 11.5,
                                fontWeight: 800,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 5,
                                maxWidth: '100%',
                              }}
                            >
                              <span style={{ opacity: 0.7, fontWeight: 900 }}>{idx + 1}.</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                {item.person}
                              </span>
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 900,
                                  color: stats.isReturned ? '#10b981' : isLight ? '#d97706' : '#fbbf24',
                                }}
                              >
                                ₹{formatINR(stats.isReturned ? stats.totalAmount : stats.remaining)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* People Cards (Tap Person Name Row to Maximize / Minimize Full Details) */}
                  {visibleItems.length === 0 ? (
                    <div
                      style={{
                        padding: '30px 16px',
                        textAlign: 'center',
                        borderRadius: 16,
                        background: palette.surfaceAlt,
                        border: `1px dashed ${palette.border}`,
                        color: palette.textMuted,
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {items.length === 0
                        ? 'No Udhaar entries yet. Tap "➕ Add Udhaar" or "📂 Upload File / Photo" above.'
                        : tab === 'pending'
                        ? '🎉 All Udhaar entries are settled!'
                        : 'No settled entries yet.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {visibleItems.map((item, idx) => {
                        const stats = getPaymentStats(item);
                        const isReturned = stats.isReturned;
                        const isPersonExpanded = Boolean(allPersonsExpanded || expandedPersonIds[item.id]);
                        const hasPhone = String(item.phone || '').replace(/[^0-9]/g, '').length >= 10;

                        return (
                          <div
                            id={`udhaar-member-card-${item.id}`}
                            key={item.id}
                            style={{
                              padding: isPersonExpanded ? '14px' : '11px 12px',
                              borderRadius: 16,
                              background: palette.surfaceAlt,
                              border: isPersonExpanded
                                ? '1.5px solid rgba(245, 158, 11, 0.45)'
                                : `1px solid ${palette.border}`,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {/* Top Row: Tap Name Header to Maximize / Minimize Person Details */}
                            <div
                              onClick={() => {
                                if (allPersonsExpanded) setAllPersonsExpanded(false);
                                togglePersonExpanded(item.id);
                              }}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 10,
                                cursor: 'pointer',
                                userSelect: 'none',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                                <div
                                  style={{
                                    minWidth: 36,
                                    height: 36,
                                    padding: '0 6px',
                                    borderRadius: 10,
                                    background: isReturned
                                      ? 'rgba(16, 185, 129, 0.16)'
                                      : 'rgba(245, 158, 11, 0.16)',
                                    color: isReturned ? '#10b981' : isLight ? '#b45309' : '#fbbf24',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 13,
                                    fontWeight: 900,
                                    flexShrink: 0,
                                  }}
                                >
                                  #{idx + 1}
                                </div>

                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 15.5, fontWeight: 900, color: palette.text }}>
                                      {item.person}
                                    </span>
                                    {hasPhone && (
                                      <span
                                        style={{
                                          padding: '1px 6px',
                                          borderRadius: 6,
                                          background: 'rgba(16, 185, 129, 0.14)',
                                          color: '#10b981',
                                          fontSize: 10,
                                          fontWeight: 800,
                                        }}
                                      >
                                        📱 {item.phone}
                                      </span>
                                    )}
                                    {item.sheetName && (
                                      <span
                                        style={{
                                          padding: '2px 7px',
                                          borderRadius: 6,
                                          background: 'rgba(99, 102, 241, 0.14)',
                                          color: isLight ? '#4338ca' : '#a5b4fc',
                                          fontSize: 10,
                                          fontWeight: 800,
                                        }}
                                      >
                                        📄 {item.sheetName}
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: 11, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                                    📅 Took on {formatShortDate(item.date)}
                                    {item.time ? ` at ${formatTime12h(item.time)}` : ''}
                                    {stats.paidCount > 0 ? ` · Paid ${stats.paidCount}x` : ''}
                                  </div>
                                </div>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                <div style={{ textAlign: 'right' }}>
                                  <div
                                    style={{
                                      fontSize: 15,
                                      fontWeight: 900,
                                      color: isReturned ? '#10b981' : isLight ? '#d97706' : '#fbbf24',
                                    }}
                                  >
                                    ₹{formatINR(isReturned ? stats.totalAmount : stats.remaining)}
                                  </div>
                                  <div style={{ fontSize: 9.5, fontWeight: 800, color: palette.textMuted }}>
                                    {isReturned ? 'SETTLED' : 'BALANCE'}
                                  </div>
                                </div>
                                <span
                                  style={{
                                    width: 26,
                                    height: 26,
                                    borderRadius: 8,
                                    background: palette.surface,
                                    border: `1px solid ${palette.border}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 12,
                                    fontWeight: 900,
                                    color: palette.textSub,
                                  }}
                                >
                                  {isPersonExpanded ? '▾' : '▸'}
                                </span>
                              </div>
                            </div>

                            {/* MAXIMIZED DETAIL VIEW WHEN PERSON NAME IS TAPPED */}
                            {isPersonExpanded && (
                              <>
                                {item.note && (
                                  <div
                                    style={{
                                      padding: '7px 10px',
                                      borderRadius: 9,
                                      background: palette.surface,
                                      border: `1px solid ${palette.border}`,
                                      fontSize: 11.5,
                                      color: palette.textSub,
                                      fontWeight: 700,
                                    }}
                                  >
                                    📝 Reason / Note: <b>{item.note}</b>
                                  </div>
                                )}

                                {/* Mobile Number & Direct WhatsApp Row */}
                                <div
                                  style={{
                                    padding: '8px 10px',
                                    borderRadius: 10,
                                    background: palette.surface,
                                    border: `1px solid ${palette.border}`,
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 170px', minWidth: 0 }}>
                                    <span style={{ fontSize: 14 }}>📱</span>
                                    <input
                                      type="tel"
                                      inputMode="numeric"
                                      value={
                                        inlinePhoneDrafts[item.id] !== undefined
                                          ? inlinePhoneDrafts[item.id]
                                          : item.phone || ''
                                      }
                                      onChange={(e) =>
                                        setInlinePhoneDrafts((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="Add mobile number for WhatsApp..."
                                      style={{
                                        width: '100%',
                                        minWidth: 0,
                                        boxSizing: 'border-box',
                                        padding: '6px 9px',
                                        borderRadius: 8,
                                        border: `1px solid ${palette.border}`,
                                        background: palette.surfaceAlt,
                                        color: palette.text,
                                        fontSize: 12,
                                        fontWeight: 800,
                                        outline: 'none',
                                      }}
                                    />
                                  </div>

                                  <div style={{ display: 'flex', gap: 6 }}>
                                    {inlinePhoneDrafts[item.id] !== undefined &&
                                      inlinePhoneDrafts[item.id] !== (item.phone || '') && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const saved = savePersonPhone(item.id, inlinePhoneDrafts[item.id]);
                                            notify(saved ? `📱 Saved mobile ${saved}` : '📱 Mobile number cleared');
                                          }}
                                          style={{
                                            padding: '6px 10px',
                                            borderRadius: 8,
                                            border: 'none',
                                            background: '#2563eb',
                                            color: '#ffffff',
                                            fontSize: 11,
                                            fontWeight: 900,
                                            cursor: 'pointer',
                                          }}
                                        >
                                          Save No.
                                        </button>
                                      )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const draftVal =
                                          inlinePhoneDrafts[item.id] !== undefined
                                            ? inlinePhoneDrafts[item.id]
                                            : item.phone || '';
                                        if (draftVal && draftVal !== item.phone) {
                                          savePersonPhone(item.id, draftVal);
                                        }
                                        sendWhatsAppReminder({ ...item, phone: draftVal });
                                      }}
                                      style={{
                                        padding: '6px 10px',
                                        borderRadius: 8,
                                        border: '1px solid rgba(16, 185, 129, 0.4)',
                                        background: 'rgba(16, 185, 129, 0.14)',
                                        color: '#10b981',
                                        fontSize: 11,
                                        fontWeight: 900,
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      💬 Share on WhatsApp
                                    </button>
                                  </div>
                                </div>

                                {/* Middle Row: Crystal-Clear 3-Column Financial Breakdown Box */}
                                <div
                                  style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr 1.1fr',
                                    gap: 6,
                                    padding: '10px',
                                    borderRadius: 12,
                                    background: palette.surface,
                                    border: `1px solid ${palette.border}`,
                                    textAlign: 'center',
                                  }}
                                >
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: palette.textMuted, textTransform: 'uppercase' }}>
                                      Total Taken
                                    </div>
                                    <div style={{ fontSize: 14.5, fontWeight: 900, color: palette.text, marginTop: 2 }}>
                                      ₹{formatINR(stats.totalAmount)}
                                    </div>
                                  </div>

                                  <div style={{ borderLeft: `1px solid ${palette.border}`, borderRight: `1px solid ${palette.border}` }}>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: palette.textMuted, textTransform: 'uppercase' }}>
                                      Paid ({stats.paidCount}x)
                                    </div>
                                    <div style={{ fontSize: 14.5, fontWeight: 900, color: '#10b981', marginTop: 2 }}>
                                      ₹{formatINR(stats.totalPaid)}
                                    </div>
                                  </div>

                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, color: palette.textMuted, textTransform: 'uppercase' }}>
                                      Balance Left
                                    </div>
                                    <div
                                      style={{
                                        fontSize: 15.5,
                                        fontWeight: 900,
                                        color: isReturned ? '#10b981' : isLight ? '#d97706' : '#fbbf24',
                                        marginTop: 2,
                                      }}
                                    >
                                      ₹{formatINR(stats.remaining)}
                                    </div>
                                  </div>
                                </div>

                                {/* Payment Installment History with INSIDE SCROLLER (Never makes the page full down!) */}
                                {stats.paidList.length > 0 && (
                                  <div
                                    style={{
                                      padding: '8px 10px',
                                      borderRadius: 10,
                                      background: palette.surface,
                                      border: `1px solid ${palette.border}`,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      gap: 6,
                                    }}
                                  >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: 10.5, fontWeight: 900, color: '#10b981', textTransform: 'uppercase' }}>
                                        Payment History ({stats.paidList.length} {stats.paidList.length === 1 ? 'Time' : 'Times'} Paid)
                                      </span>
                                      {stats.paidList.length > 3 && (
                                        <span style={{ fontSize: 10, fontWeight: 700, color: palette.textMuted }}>
                                          ↕ Scroll inside
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        maxHeight: 124,
                                        overflowY: 'auto',
                                        WebkitOverflowScrolling: 'touch',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 5,
                                        paddingRight: 4,
                                      }}
                                    >
                                      {stats.paidList.map((p, pIdx) => (
                                        <div
                                          key={p.id || pIdx}
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            fontSize: 11.5,
                                            fontWeight: 700,
                                            color: palette.textSub,
                                            padding: '4px 6px',
                                            borderRadius: 7,
                                            background: palette.surfaceAlt,
                                          }}
                                        >
                                          <span>
                                            #{pIdx + 1} · <b style={{ color: '#10b981' }}>₹{formatINR(p.amount)}</b> via{' '}
                                            <b>{p.paidThrough || 'UPI'}</b> · {formatShortDate(p.paidDate)}
                                            {p.paidTime ? ` ${formatTime12h(p.paidTime)}` : ''}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() => handleRemovePaymentRecord(item.id, p.id)}
                                            style={{
                                              border: 'none',
                                              background: 'transparent',
                                              color: palette.textMuted,
                                              fontSize: 11,
                                              cursor: 'pointer',
                                              padding: '0 4px',
                                            }}
                                            title="Remove payment entry"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Bottom 3-Button Action Row */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 0.85fr', gap: 8 }}>
                                  <button
                                    type="button"
                                    onClick={() => openRecordPaymentModal(item)}
                                    style={{
                                      padding: '9px 10px',
                                      borderRadius: 10,
                                      border: 'none',
                                      background: '#10b981',
                                      color: '#ffffff',
                                      fontWeight: 900,
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    💵 Record Paid
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => sendWhatsAppReminder(item)}
                                    style={{
                                      padding: '9px 10px',
                                      borderRadius: 10,
                                      border: `1px solid ${palette.border}`,
                                      background: palette.surface,
                                      color: '#10b981',
                                      fontWeight: 800,
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    💬 WhatsApp
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setEditItem({ ...item })}
                                    style={{
                                      padding: '9px 10px',
                                      borderRadius: 10,
                                      border: `1px solid ${palette.border}`,
                                      background: palette.surface,
                                      color: palette.textSub,
                                      fontWeight: 800,
                                      fontSize: 12,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    ✏️ Edit
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL 1: CLEAN "ADD UDHAAR" POPUP (With Mobile Number for WhatsApp)
         ═══════════════════════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div
          onClick={() => setShowAddModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAdd}
            style={{
              width: '100%',
              maxWidth: 390,
              borderRadius: 22,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
              color: palette.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 17, fontWeight: 900 }}>➕ Add New Udhaar</div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
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

            {uploadedScreenshotPreview && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 8,
                  borderRadius: 10,
                  background: palette.surfaceAlt,
                  border: `1px solid ${palette.border}`,
                }}
              >
                <img
                  src={uploadedScreenshotPreview.dataUrl}
                  alt="Screenshot"
                  style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8 }}
                />
                <div style={{ fontSize: 11.5, fontWeight: 700, color: palette.textSub }}>
                  📷 {uploadedScreenshotPreview.fileName}
                </div>
              </div>
            )}

            <div>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Friend / Person Name
              </div>
              <input
                type="text"
                autoFocus
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                placeholder="e.g. Raju, Kiran"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 14.5,
                  fontWeight: 800,
                  outline: 'none',
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 8 }}>
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  Amount Given (₹)
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="₹ 0"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 15.5,
                    fontWeight: 900,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                  📱 Mobile No. (WhatsApp)
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="10-digit mobile"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13.5,
                    fontWeight: 800,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted }}>
                  When did he take?
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { label: 'Today', iso: getTodayIso() },
                    { label: 'Yesterday', iso: getRelativeDateIso(1) },
                  ].map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      onClick={() => setDate(chip.iso)}
                      style={{
                        padding: '3px 9px',
                        borderRadius: 999,
                        border: date === chip.iso ? '1px solid #f59e0b' : `1px solid ${palette.border}`,
                        background: date === chip.iso ? 'rgba(245, 158, 11, 0.16)' : palette.surfaceAlt,
                        color: date === chip.iso ? '#f59e0b' : palette.textMuted,
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
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
                    padding: '10px',
                    borderRadius: 12,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13,
                    fontWeight: 800,
                  }}
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 12,
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
              <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, marginBottom: 4 }}>
                Note / Reason (Optional)
              </div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Lunch, Petrol, Emergency"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.text,
                  fontSize: 13,
                  fontWeight: 700,
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: '12px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
                color: '#ffffff',
                fontWeight: 900,
                fontSize: 14,
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              ✓ Save Udhaar
            </button>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL 2: CLEAN "RECORD PAYMENT" POPUP (How Much Paid, Paid Through, Paid Date)
         ═══════════════════════════════════════════════════════════════════════ */}
      {paymentModalItem && (
        <div
          onClick={() => setPaymentModalItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSavePayment}
            style={{
              width: '100%',
              maxWidth: 390,
              borderRadius: 22,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              color: palette.text,
            }}
          >
            {(() => {
              const stats = getPaymentStats(paymentModalItem);
              return (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 16.5, fontWeight: 900 }}>
                        💵 Record Payment · {paymentModalItem.person}
                      </div>
                      <div style={{ fontSize: 11.5, color: palette.textMuted, fontWeight: 700, marginTop: 2 }}>
                        Total ₹{formatINR(stats.totalAmount)} · Paid {stats.paidCount}x (₹{formatINR(stats.totalPaid)}) ·{' '}
                        <b style={{ color: '#f59e0b' }}>Left ₹{formatINR(stats.remaining)}</b>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPaymentModalItem(null)}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted }}>
                        How much did he pay? (₹)
                      </span>
                      {stats.remaining > 0 && (
                        <button
                          type="button"
                          onClick={() => setPayAmountDraft(String(stats.remaining))}
                          style={{
                            padding: '2px 8px',
                            borderRadius: 999,
                            border: '1px solid #10b981',
                            background: 'rgba(16, 185, 129, 0.14)',
                            color: '#10b981',
                            fontSize: 10.5,
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          Full ₹{formatINR(stats.remaining)}
                        </button>
                      )}
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      autoFocus
                      value={payAmountDraft}
                      onChange={(e) => setPayAmountDraft(e.target.value)}
                      placeholder="₹ Enter amount paid"
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '11px 12px',
                        borderRadius: 12,
                        border: `1px solid ${palette.border}`,
                        background: palette.surfaceAlt,
                        color: palette.text,
                        fontSize: 16,
                        fontWeight: 900,
                        outline: 'none',
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted, marginBottom: 6 }}>
                      Paid Through
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                      {PAYMENT_MODES.map((mode) => {
                        const active = payThroughDraft === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setPayThroughDraft(mode)}
                            style={{
                              padding: '8px',
                              borderRadius: 10,
                              border: active ? '1.5px solid #10b981' : `1px solid ${palette.border}`,
                              background: active ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                              color: active ? '#10b981' : palette.text,
                              fontSize: 12,
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

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                      <span style={{ fontSize: 11.5, fontWeight: 800, color: palette.textMuted }}>
                        When did he pay?
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {[
                          { label: 'Today', iso: getTodayIso() },
                          { label: 'Yesterday', iso: getRelativeDateIso(1) },
                        ].map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => setPayDateDraft(c.iso)}
                            style={{
                              padding: '3px 9px',
                              borderRadius: 999,
                              border: payDateDraft === c.iso ? '1px solid #10b981' : `1px solid ${palette.border}`,
                              background: payDateDraft === c.iso ? 'rgba(16, 185, 129, 0.16)' : palette.surfaceAlt,
                              color: payDateDraft === c.iso ? '#10b981' : palette.textMuted,
                              fontSize: 11,
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                      <input
                        type="date"
                        value={payDateDraft}
                        onChange={(e) => setPayDateDraft(e.target.value)}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: '10px',
                          borderRadius: 12,
                          border: `1px solid ${palette.border}`,
                          background: palette.surfaceAlt,
                          color: palette.text,
                          fontSize: 13,
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
                          padding: '10px',
                          borderRadius: 12,
                          border: `1px solid ${palette.border}`,
                          background: palette.surfaceAlt,
                          color: palette.text,
                          fontSize: 13,
                          fontWeight: 800,
                        }}
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    style={{
                      padding: '12px',
                      borderRadius: 12,
                      border: 'none',
                      background: '#10b981',
                      color: '#ffffff',
                      fontWeight: 900,
                      fontSize: 14,
                      cursor: 'pointer',
                      marginTop: 4,
                    }}
                  >
                    ✅ Save Payment (₹{formatINR(payAmountDraft || 0)} via {payThroughDraft})
                  </button>
                </>
              );
            })()}
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL 3: CLEAN "EDIT UDHAAR" POPUP (With Mobile Number)
         ═══════════════════════════════════════════════════════════════════════ */}
      {editItem && (
        <div
          onClick={() => setEditItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.78)',
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
              borderRadius: 22,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 20,
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.15fr', gap: 8 }}>
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
                  📱 Mobile No. (WhatsApp)
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={editItem.phone || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="10-digit mobile"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px',
                    borderRadius: 10,
                    border: `1px solid ${palette.border}`,
                    background: palette.surfaceAlt,
                    color: palette.text,
                    fontSize: 13.5,
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

            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
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
                  Sheet / Group
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

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => deleteEntry(editItem.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#ef4444',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                🗑️ Delete
              </button>
              <button
                type="button"
                onClick={() => {
                  toggleStatus(editItem.id);
                  setEditItem(null);
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: '#10b981',
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ✅ Full Paid
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                ✓ Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          MODAL 4: DIRECT WHATSAPP MOBILE NUMBER PROMPT
         ═══════════════════════════════════════════════════════════════════════ */}
      {whatsAppPhonePromptItem && (
        <div
          onClick={() => setWhatsAppPhonePromptItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            background: 'rgba(2, 6, 23, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const cleanDigits = String(whatsAppPhoneDraft || '').replace(/[^0-9]/g, '');
              if (cleanDigits.length < 10) {
                notify('Enter valid 10-digit mobile number');
                return;
              }
              savePersonPhone(whatsAppPhonePromptItem.id, cleanDigits);
              const updatedItem = { ...whatsAppPhonePromptItem, phone: cleanDigits };
              setWhatsAppPhonePromptItem(null);
              sendWhatsAppReminder(updatedItem, cleanDigits);
            }}
            style={{
              width: '100%',
              maxWidth: 370,
              borderRadius: 22,
              background: palette.surface,
              border: `1px solid ${palette.border}`,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              color: palette.text,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 900 }}>
                💬 Share to {whatsAppPhonePromptItem.person}
              </div>
              <button
                type="button"
                onClick={() => setWhatsAppPhonePromptItem(null)}
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

            <div style={{ fontSize: 12, fontWeight: 700, color: palette.textSub, lineHeight: 1.45 }}>
              Enter <b>{whatsAppPhonePromptItem.person}&apos;s</b> mobile number to save it and send their full Udhaar details directly on WhatsApp:
            </div>

            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={whatsAppPhoneDraft}
              onChange={(e) => setWhatsAppPhoneDraft(e.target.value)}
              placeholder="📱 Enter 10-digit WhatsApp Number"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '11px 12px',
                borderRadius: 12,
                border: `1px solid ${palette.border}`,
                background: palette.surfaceAlt,
                color: palette.text,
                fontSize: 15,
                fontWeight: 900,
                outline: 'none',
              }}
            />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const itemToSend = whatsAppPhonePromptItem;
                  setWhatsAppPhonePromptItem(null);
                  sendWhatsAppReminder(itemToSend, '');
                }}
                style={{
                  padding: '11px 12px',
                  borderRadius: 12,
                  border: `1px solid ${palette.border}`,
                  background: palette.surfaceAlt,
                  color: palette.textSub,
                  fontWeight: 800,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Pick Contact
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '11px 12px',
                  borderRadius: 12,
                  border: 'none',
                  background: '#10b981',
                  color: '#ffffff',
                  fontWeight: 900,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                💬 Save &amp; Send WhatsApp
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
