/************
 * - Handles inbound (Queue upsert), delivery callbacks (Master.sent_at),
 *   click events (Master.clicked_at), consent (STOP/START/YES/UNSTOP),
 *   idempotency (CacheService), and lightweight ping logging.
 *
 * NOTE: Secret gate is OFF per request.
 ************/

// ========= CONFIG =========
// Legacy fallback sheet id (used only when Script Property is not set and enforcement is off)
const FALLBACK_SHEET_ID = '1jP3tMRRd-p3xkziVbYwiCjfAfz4gJZOMXOeGrPIorFI';

// Prefer a deploy-time Script Property `SHEET_ID`. When configured it will be used
// for all sheet operations. Leave empty to use the legacy fallback (not recommended).
let SCRIPT_SHEET_ID = '';
try {
  SCRIPT_SHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
} catch (_e) {
  SCRIPT_SHEET_ID = '';
}
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

function getActiveSheetId_() {
  return SCRIPT_SHEET_ID || FALLBACK_SHEET_ID;
}

function openSS_() { return SpreadsheetApp.openById(getActiveSheetId_()); }

// Kill-switch: if a sheet named `Config` exists and cell B2 is set to OFF (case-insensitive),
// webhook handlers will no-op and avoid writing to the sheets. This gives operators a quick
// emergency stop without changing code or deployment.
function killSwitchIsOff_(ss) {
  try {
    const cfg = ss.getSheetByName('Config');
    if (!cfg) return false;
    const v = String(cfg.getRange('B2').getValue() || '').toUpperCase().trim();
    return v === 'OFF' || v === '0' || v === 'FALSE' || v === 'NO';
  } catch (_e) {
    return false;
  }
}

// Create a Config sheet (if missing) and set B2 to 'ON'. Useful to seed the kill-switch.
function createConfigSheetAndEnable_(ss) {
  try {
    let cfg = ss.getSheetByName('Config');
    if (!cfg) cfg = ss.insertSheet('Config');
    cfg.getRange('A1').setValue('Key');
    cfg.getRange('B1').setValue('Value');
    cfg.getRange('A2').setValue('WebhookEnabled');
    cfg.getRange('B2').setValue('ON');
    return true;
  } catch (e) {
    return false;
  }
}

// Create a saved filter view named "Today's Replies" on the Queue sheet.
// It filters `status` to show only recent working statuses and (when using the
// Advanced Sheets API) sorts by `responded_at` descending. The Advanced API path
// will create a named Filter View. If the Advanced Service is not enabled, it
// falls back to creating a normal Filter WITHOUT reordering the sheet (non-destructive).
function createTodaysRepliesFilterView_() {
  try {
    const ss = openSS_();
    const sh = ss.getSheetByName(QUEUE_TAB);
    if (!sh) return {ok:false, msg:'Queue sheet not found'};
    const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    const cStatus = findCol_(header, 'status');
    const cResp = findCol_(header, 'responded_at');
    const sheetId = sh.getSheetId();

    if (!cStatus || !cResp) return {ok:false, msg:'Required columns missing (status/responded_at)'};

    const spreadsheetId = getActiveSheetId_();

    // Build a filter view request — show only these visible values for status and sort by responded_at desc
    const req = {
      requests: [
        {
          addFilterView: {
            filter: {
              title: "Today's Replies",
              range: {
                sheetId: sheetId,
                startRowIndex: 1,
                endRowIndex: Math.max(1000, sh.getLastRow()),
                startColumnIndex: 0,
                endColumnIndex: sh.getLastColumn()
              },
              criteria: {},
              sortSpecs: [
                {
                  dimensionIndex: cResp - 1,
                  sortOrder: 'DESCENDING'
                }
              ]
            }
          }
        }
      ]
    };

    // Add status criteria if possible (ONE_OF_LIST via visibleValues)
    // For Filter Views the Sheets API does not accept a ONE_OF_LIST condition.
    // Instead, supply `hiddenValues` listing statuses to hide (non-exhaustive canonical set).
    // This effectively shows only the desired statuses without relying on an unsupported condition.
    req.requests[0].addFilterView.filter.criteria[cStatus - 1] = {
      hiddenValues: ['booked','closed','dnd','wrong_number']
    };

    try {
      // Requires enabling Advanced Sheets service (Resources > Advanced Google services...)
      Sheets.Spreadsheets.batchUpdate(req, spreadsheetId);
      return {ok:true, msg:'Filter view created (advanced API)'};
    } catch (e) {
      // Log the error to Ping for easier diagnosis (includes stack/message)
      try { logPing_(ss, JSON.stringify({error: String(e), stack: (e && e.stack) || ''}), '', 'filter-view-error'); } catch (_ee) {}
      // Fallback: create a normal Filter without reordering the sheet (non-destructive)
      const range = sh.getRange(1,1,Math.max(2, sh.getLastRow()), sh.getLastColumn());
      try {
        const f = range.createFilter();
        // Fallback only creates a normal Filter (no sheet reorder) to avoid changing SoR order.
        return {ok:true, msg:'Filter created (fallback) — filter applied (no sort)'};
      } catch (e2) {
        try { logPing_(ss, JSON.stringify({error2: String(e2), stack: (e2 && e2.stack) || ''}), '', 'filter-view-error2'); } catch (_ee) {}
        return {ok:false, msg:'Failed to create filter: ' + e2};
      }
    }
  } catch (e) {
    return {ok:false, msg:'error: ' + e};
  }
}

// Zero-arg wrappers so these helpers are runnable from the Apps Script editor.
function runCreateConfig() {
  const ok = createConfigSheetAndEnable_(openSS_());
  Logger.log('createConfigSheetAndEnable_ -> ' + ok);
  return ok;
}

function runCreateTodaysRepliesFilterView() {
  const res = createTodaysRepliesFilterView_();
  Logger.log('createTodaysRepliesFilterView_ -> ' + JSON.stringify(res));
  return res;
}

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
  const storePhone = "'+1" + fromNorm; // store as text +1XXXXXXXXXX (leading apostrophe to avoid reformat)

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
  const cT1     = findCol_(header, 't1_sent_at');
  const cT2     = findCol_(header, 't2_sent_at');
  const cClick  = findCol_(header, 'clicked_at');
  const cStage  = findCol_(header, 'followup_stage');
  const cDnd    = findCol_(header, 'do_not_text');

  if (cPhone === -1) return;

  const lastRow = sh.getLastRow();
  const cols = sh.getLastColumn();
  const rows = lastRow > 1 ? sh.getRange(2,1,lastRow-1,cols).getValues() : [];

  const rIdxs = [];
  for (let r = 0; r < rows.length; r++) {
    if (normPhone_(rows[r][cPhone-1]) === toNorm) { rIdxs.push(r + 2); }
  }
  if (!rIdxs.length) return;
  try { logPing_(ss, JSON.stringify({to: toNorm, matches: rIdxs.length, updates}), '', 'master-update-debug'); } catch (_e) {}
  rIdxs.forEach(function(rIdx) {
    // cache current values per row
    const curT1 = cT1 !== -1 ? sh.getRange(rIdx, cT1).getValue() : null;
    const curT2 = cT2 !== -1 ? sh.getRange(rIdx, cT2).getValue() : null;

    // sent_at / clicked_at: only set if empty (first-write wins) unless caller forces it
    if (cSent !== -1 && updates.sent_at) {
      try {
        const curSent = sh.getRange(rIdx, cSent).getValue();
        if (!curSent || updates.forceSent) sh.getRange(rIdx, cSent).setValue(updates.sent_at);
      } catch (e) {
        sh.getRange(rIdx, cSent).setValue(updates.sent_at);
      }
    }

    // Touch-level sent tracking (t1/t2) — first-write wins per column.
    if (updates.t2_sent_at && cT2 !== -1) {
      try {
        if (!curT2 || updates.forceT2) sh.getRange(rIdx, cT2).setValue(updates.t2_sent_at);
      } catch (_e) {}
    } else if (updates.sent_at && cT1 !== -1) {
      try {
        if (!curT1) {
          sh.getRange(rIdx, cT1).setValue(updates.sent_at);
        } else if (cT2 !== -1 && !curT2) {
          sh.getRange(rIdx, cT2).setValue(updates.sent_at);
        }
      } catch (_e) {}
    }

    if (cClick !== -1 && updates.clicked_at) {
      try {
        const curClicked = sh.getRange(rIdx, cClick).getValue();
        if (!curClicked || updates.forceClicked) sh.getRange(rIdx, cClick).setValue(updates.clicked_at);
      } catch (e) {
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
  });
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
        }
      }
    }
  }
}

// ========= GET (ping) =========
function doGet(e) {
  // Fail-closed when enforcement is active and no SCRIPT_SHEET_ID is configured
  if (ENFORCE_KEY && !SCRIPT_SHEET_ID) {
    const hdrs = (e && e.headers) || {};
    const raw = e && e.parameter ? JSON.stringify(e.parameter) : '';
    // Log a diagnostic row then return
    const ss = SpreadsheetApp.getActive ? SpreadsheetApp.getActive() : null;
    try { if (ss) logPing_(ss, raw, JSON.stringify(hdrs), 'missing_sheet_config'); } catch (_e) {}
    return ContentService.createTextOutput('ok');
  }

  const ss = openSS_();
  // Respect kill-switch: when OFF, do not write to sheets.
  if (killSwitchIsOff_(ss)) return ContentService.createTextOutput('ok (disabled)');
  const tag = 'ping-v5-' + new Date().toISOString();
  logPing_(ss, JSON.stringify(e && e.parameter || {}), JSON.stringify(e && e.headers || {}), tag);
  return ContentService.createTextOutput('ok ' + tag);
}

// ========= POST (main) =========
function doPost(e) {
  // Secret gate (disabled)
  if (ENFORCE_KEY) {
    const hdrs = (e && e.headers) || {};
    const key = hdrs['x-rb-key'] || hdrs['X-RB-Key'] || '';
    // If enforcement is enabled but no key is configured in Script Properties, deny (fail-closed).
    if (!X_RB_KEY) {
      // best-effort ping to the active spreadsheet (if available) to record the event
      try { const ssx = SpreadsheetApp.getActive(); logPing_(ssx, e && e.postData ? e.postData.contents || '' : '', JSON.stringify(hdrs), 'unauthorized_no_config'); } catch (_e) {}
      return ContentService.createTextOutput('ok');
    }
    if (key !== X_RB_KEY) {
      try { const ssx = SpreadsheetApp.getActive(); logPing_(ssx, e && e.postData ? e.postData.contents || '' : '', JSON.stringify(hdrs), 'unauthorized'); } catch (_e) {}
      return ContentService.createTextOutput('ok');
    }
  }

  // Fail-closed when enforcement is active and no SCRIPT_SHEET_ID is configured
  if (ENFORCE_KEY && !SCRIPT_SHEET_ID) {
    const hdrs = (e && e.headers) || {};
    try { const ssx = SpreadsheetApp.getActive(); logPing_(ssx, e && e.postData ? e.postData.contents || '' : '', JSON.stringify(hdrs), 'missing_sheet_config'); } catch (_e) {}
    return ContentService.createTextOutput('ok');
  }

  const ss = openSS_();
  // Respect kill-switch: when OFF, do not write to sheets.
  if (killSwitchIsOff_(ss)) return ContentService.createTextOutput('ok (disabled)');

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
    updateMasterByTo_(ss, toNorm, { clicked_at: clickedAt, followup_stage: 2, forceStage: true, forceClicked: true });
    return ContentService.createTextOutput('ok');
  }

  // Delivery
  if (eventType === 'delivery' || msgStatus === 'sent' || msgStatus === 'delivered') {
    if (toNorm) {
      const sentAt = body.delivered_at || new Date().toISOString();
      updateMasterByTo_(ss, toNorm, { sent_at: sentAt, t2_sent_at: sentAt, followup_stage: 1, forceStage: true, forceT2: true });
    }
    return ContentService.createTextOutput('ok');
  }

  // Unknown
  return ContentService.createTextOutput('ok');
}
