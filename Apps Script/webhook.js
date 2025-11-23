/************
 * Best Office Staff — Webhook (Apps Script)
 * - Handles inbound (Queue upsert), delivery callbacks (Master.sent_at),
 *   click events (Master.clicked_at), consent (STOP/START/YES/UNSTOP),
 *   idempotency (CacheService), and lightweight ping logging.
 *
 * NOTE: Secret gate is OFF per request.
 ************/

// ========= CONFIG =========
const SHEET_ID   = '1jP3tMRRd-p3xkziVbYwiCjfAfz4gJZOMXOeGrPIorFI';
const QUEUE_TAB  = 'Queue';
const MASTER_TAB = 'Master';

// Idempotency window (seconds)
const DEDUP_TTL_SEC = 7200;

// Shared-secret (DISABLED per request)
const ENFORCE_KEY  = false;
// Read the expected X-RB-Key from Script Properties so deploy-time config is possible
let X_RB_KEY = '';
try {
  X_RB_KEY = PropertiesService.getScriptProperties().getProperty('X_RB_KEY') || '';
} catch (_e) {
  X_RB_KEY = '';
}

// ========= UTILITIES =========
const toSnake_ = s => String(s || '').toLowerCase().trim().replace(/\s+/g, '_');

function findCol_(header, name) {
  const want = toSnake_(name);
  for (let i = 0; i < header.length; i++) {
    const h = toSnake_(header[i] || '');
    if (h === want) return i + 1;
  }
  return -1;
}

function normPhone_(p) {
  if (p === null || p === undefined) return '';
  const d = String(p).replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length >= 10) return d.slice(-10);
  return d;
}

function seenBefore_(key, ttlSec) {
  try {
    const cache = CacheService.getScriptCache();
    if (cache.get(key)) return true;
    cache.put(key, String(Date.now()), ttlSec || DEDUP_TTL_SEC);
    return false;
  } catch (_e) {
    return false; // fail-open on cache issues
  }
}

function getBody_(e) {
  if (!e || !e.postData) return {};
  const raw = e.postData.contents || '';
  const ct  = (e.postData.type || '').toLowerCase();
  if (ct.indexOf('application/json') !== -1) {
    try { return JSON.parse(raw || '{}'); } catch (_){ return {}; }
  }
  try { return JSON.parse(raw || '{}'); } catch (_){}
  // fallback: form-encoded
  const kv = {};
  (raw || '').split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) kv[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return kv;
}

function openSS_() { return SpreadsheetApp.openById(SHEET_ID); }

// lightweight ping logger
function logPing_(ss, raw, headers, tag) {
  try {
    const sh = ss.getSheetByName('Ping') || ss.insertSheet('Ping');
    if (sh.getLastRow() === 0) {
      sh.appendRow(['ts', 'raw', 'headers', 'tag']);
    }
    sh.appendRow([new Date(), raw, headers, tag]);
  } catch (_e) {}
}

// ========= SHEET OPS =========
function upsertQueue_(ss, fromNorm, noteSnippet, opts) {
  const sh = ss.getSheetByName(QUEUE_TAB);
  if (!sh) return;

  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const cPhone = findCol_(header, 'e164_phone');
  const cResp  = findCol_(header, 'responded_at');
  const cLast  = findCol_(header, 'last_action_at');
  const cNext  = findCol_(header, 'next_action_at');
  const cStat  = findCol_(header, 'status');
  const cNotes = findCol_(header, 'notes');
  const cDnd   = findCol_(header, 'do_not_text'); // optional

  const now = new Date();
  const storePhone = '1' + fromNorm; // store as 11-digit string (no plus)

  const lastRow = sh.getLastRow();
  const cols = sh.getLastColumn();
  const rows = lastRow > 1 ? sh.getRange(2,1,lastRow-1,cols).getValues() : [];

  let rIdx = -1;
  if (cPhone > 0) {
    for (let r = 0; r < rows.length; r++) {
      if (normPhone_(rows[r][cPhone-1]) === fromNorm) { rIdx = r + 2; break; }
    }
  }

  const strong = new Set(['booked','closed','dnd','wrong_number']);
  const desiredStatus = (opts && opts.status) ? String(opts.status).toLowerCase() : 'new';
  const nextActionAt  = opts && opts.nextActionAt ? opts.nextActionAt : '';
  const forceStatus   = !!(opts && opts.forceStatus);  // <-- NEW: allow overriding strong statuses

  if (rIdx === -1) {
    const newRow = new Array(header.length).fill('');
    if (cPhone>0) newRow[cPhone-1] = storePhone;
    if (cResp>0)  newRow[cResp-1]  = now;
    if (cLast>0)  newRow[cLast-1]  = now;
    if (cNext>0)  newRow[cNext-1]  = nextActionAt;
    if (cStat>0)  newRow[cStat-1]  = desiredStatus;
    if (cNotes>0) newRow[cNotes-1] = noteSnippet;
    if (cDnd>0 && typeof opts?.dnd === 'boolean') newRow[cDnd-1] = opts.dnd;
    sh.appendRow(newRow);
  } else {
    if (cResp>0) sh.getRange(rIdx, cResp).setValue(now);
    if (cLast>0) sh.getRange(rIdx, cLast).setValue(now);
    if (cNext>0 && nextActionAt) sh.getRange(rIdx, cNext).setValue(nextActionAt);
    if (cNotes>0) {
      const prev = sh.getRange(rIdx, cNotes).getValue();
      const next = (prev ? prev + ' | ' : '') + noteSnippet;
      sh.getRange(rIdx, cNotes).setValue(next);
    }
    if (cStat>0) {
      const cur = String(sh.getRange(rIdx, cStat).getValue() || '').toLowerCase();
      if (forceStatus) {
        sh.getRange(rIdx, cStat).setValue(desiredStatus);        // <-- override for consent recovery
      } else if (!strong.has(cur)) {
        sh.getRange(rIdx, cStat).setValue(desiredStatus);
      }
    }
    if (cDnd>0 && typeof opts?.dnd === 'boolean') sh.getRange(rIdx, cDnd).setValue(opts.dnd);
  }
}

function updateMasterByTo_(ss, toNorm, updates) {
  const sh = ss.getSheetByName(MASTER_TAB);
  if (!sh) return;

  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const cPhone  = findCol_(header, 'e164_phone');
  const cSent   = findCol_(header, 'sent_at');
  const cClick  = findCol_(header, 'clicked_at');
  const cStage  = findCol_(header, 'followup_stage');
  const cDnd    = findCol_(header, 'do_not_text');

  if (cPhone === -1) return;

  const lastRow = sh.getLastRow();
  const cols = sh.getLastColumn();
  const rows = lastRow > 1 ? sh.getRange(2,1,lastRow-1,cols).getValues() : [];

  let rIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    if (normPhone_(rows[r][cPhone-1]) === toNorm) { rIdx = r + 2; break; }
  }
  if (rIdx === -1) return;
  // sent_at / clicked_at: only set if empty (first-write wins) unless caller forces it
  if (cSent !== -1 && updates.sent_at) {
    try {
      const curSent = sh.getRange(rIdx, cSent).getValue();
      if (!curSent || updates.forceSent) sh.getRange(rIdx, cSent).setValue(updates.sent_at);
    } catch (e) {
      // best-effort write if reading fails
      sh.getRange(rIdx, cSent).setValue(updates.sent_at);
    }
  }

  if (cClick !== -1 && updates.clicked_at) {
    try {
      const curClicked = sh.getRange(rIdx, cClick).getValue();
      if (!curClicked || updates.forceClicked) sh.getRange(rIdx, cClick).setValue(updates.clicked_at);
    } catch (e) {
      // best-effort write if reading fails
      sh.getRange(rIdx, cClick).setValue(updates.clicked_at);
    }
  }

  if (typeof updates.followup_stage !== 'undefined' && cStage !== -1) {
    const cur = sh.getRange(rIdx, cStage).getValue();
    if (!cur || updates.forceStage) sh.getRange(rIdx, cStage).setValue(updates.followup_stage);
  }
  if (typeof updates.dnd === 'boolean' && cDnd !== -1) {
    sh.getRange(rIdx, cDnd).setValue(updates.dnd);
  }
}

function setDoNotTextEverywhere_(ss, phoneNorm, flagBool) {
  updateMasterByTo_(ss, phoneNorm, { dnd: flagBool });
  const q = ss.getSheetByName(QUEUE_TAB);
  if (q) {
    const header = q.getRange(1,1,1,q.getLastColumn()).getValues()[0];
    const cPhone = findCol_(header, 'e164_phone');
    const cDnd   = findCol_(header, 'do_not_text');
    const cStat  = findCol_(header, 'status');
    if (cPhone > 0 && cDnd > 0) {
      const lastRow = q.getLastRow();
      const cols = q.getLastColumn();
      const rows = lastRow > 1 ? q.getRange(2,1,lastRow-1,cols).getValues() : [];
      for (let i = 0; i < rows.length; i++) {
        if (normPhone_(rows[i][cPhone-1]) === phoneNorm) {
          q.getRange(i+2, cDnd).setValue(flagBool);
          if (flagBool && cStat > 0) q.getRange(i+2, cStat).setValue('dnd');
          break;
        }
      }
    }
  }
}

// ========= GET (ping) =========
function doGet(e) {
  const ss = openSS_();
  const tag = 'ping-v5-' + new Date().toISOString();
  logPing_(ss, JSON.stringify(e && e.parameter || {}), JSON.stringify(e && e.headers || {}), tag);
  return ContentService.createTextOutput('ok ' + tag);
}

// ========= POST (main) =========
function doPost(e) {
  const ss = openSS_();

  // Secret gate (disabled)
  if (ENFORCE_KEY) {
    const hdrs = (e && e.headers) || {};
    const key = hdrs['x-rb-key'] || hdrs['X-RB-Key'] || '';
    // If enforcement is enabled but no key is configured in Script Properties, deny (fail-closed).
    if (!X_RB_KEY) {
      logPing_(ss, e && e.postData ? e.postData.contents || '' : '', JSON.stringify(hdrs), 'unauthorized_no_config');
      return ContentService.createTextOutput('ok');
    }
    if (key !== X_RB_KEY) {
      logPing_(ss, e && e.postData ? e.postData.contents || '' : '', JSON.stringify(hdrs), 'unauthorized');
      return ContentService.createTextOutput('ok');
    }
  }

  const body = getBody_(e);
  const eventType = String(body.event_type || body.EventType || body.event || '').toLowerCase();
  const msgStatus = String(body.message_status || body.MessageStatus || '').toLowerCase();

  const toRaw   = body.to   || body.To   || '';
  const fromRaw = body.from || body.From || '';
  const textRaw = body.body || body.Body || '';

  const toNorm   = normPhone_(toRaw);
  const fromNorm = normPhone_(fromRaw);
  const textUp   = String(textRaw || '').trim().toUpperCase();

  // Log every POST into Ping
  try { logPing_(ss, e && e.postData ? (e.postData.contents || '') : '', JSON.stringify(e && e.headers || {}), 'post'); } catch (_e) {}

  // Idempotency key
  let dedupKey = '';
  if (eventType === 'inbound' || (!!fromNorm && textRaw)) {
    dedupKey = 'inb:' + (body.message_sid || body.MessageSid || (fromNorm + ':' + Utilities.base64Encode(textRaw).slice(0,24)));
  } else if (eventType === 'click') {
    const clkAt = body.clicked_at || body.ClickedAt || '';
    dedupKey = 'clk:' + (toNorm || '') + ':' + clkAt;
  } else if (eventType === 'delivery' || msgStatus === 'sent' || msgStatus === 'delivered') {
    dedupKey = 'dlv:' + (body.message_sid || body.MessageSid || '') + ':' + (msgStatus || 'delivery');
  } else {
    dedupKey = 'unk:' + Utilities.getUuid();
  }
  if (seenBefore_(dedupKey, DEDUP_TTL_SEC)) {
    return ContentService.createTextOutput('ok');
  }

  // Consent first
  const isStop  = textUp === 'STOP' || textUp.startsWith('STOP ');
  const isStart = textUp === 'START' || textUp === 'UNSTOP' || textUp === 'YES';

  if (isStop && fromNorm) {
    setDoNotTextEverywhere_(ss, fromNorm, true);
    upsertQueue_(ss, fromNorm, 'STOP', { status: 'dnd', dnd: true, forceStatus: true }); // force dnd
    return ContentService.createTextOutput('ok');
  }
  if (isStart && fromNorm) {
    setDoNotTextEverywhere_(ss, fromNorm, false);
    upsertQueue_(ss, fromNorm, 'START', { status: 'new', dnd: false, forceStatus: true }); // <-- forceStatus fixes your case
    return ContentService.createTextOutput('ok');
  }

  // Inbound message
  if (eventType === 'inbound' || (!!fromNorm && textRaw)) {
    const snippet = String(textRaw).slice(0, 120);
    upsertQueue_(ss, fromNorm, snippet, { status: 'new' });
    return ContentService.createTextOutput('ok');
  }

  // Click
  if (eventType === 'click' && toNorm) {
    const clickedAt = body.clicked_at || new Date().toISOString();
    updateMasterByTo_(ss, toNorm, { clicked_at: clickedAt, followup_stage: 2, forceStage: true });
    return ContentService.createTextOutput('ok');
  }

  // Delivery
  if (eventType === 'delivery' || msgStatus === 'sent' || msgStatus === 'delivered') {
    if (toNorm) {
      const sentAt = body.delivered_at || new Date().toISOString();
      updateMasterByTo_(ss, toNorm, { sent_at: sentAt, followup_stage: 1 });
    }
    return ContentService.createTextOutput('ok');
  }

  // Unknown
  return ContentService.createTextOutput('ok');
}
