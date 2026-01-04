/**
 * Lightweight Ping monitor for RecallBridge.
 *
 * Scans the Ping sheet for recent rows whose tag or raw payload suggests errors,
 * and returns/prints a concise summary. Intended for use with a time-based trigger.
 *
 * Configuration:
 * - LOOKBACK_HOURS: window to scan (defaults to 24h).
 * - ERROR_PATTERNS: substrings to flag in tag/raw/headers.
 *
 * Usage:
 * - Add this file to the Apps Script project.
 * - Set a time-based trigger (e.g., hourly) on runPingMonitor.
 * - Optional: wire to email/Slack by replacing the Logger.log calls.
 */

const LOOKBACK_HOURS = 24;
const ERROR_PATTERNS = ['error', 'fail', 'unauthorized', 'missing_sheet_config', 'filter-view-error'];

function runPingMonitor() {
  const ss = openSS_ ? openSS_() : SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Ping');
  if (!sh) {
    Logger.log('Ping sheet not found');
    return 'no_ping_sheet';
  }
  const now = new Date();
  const lookbackMs = LOOKBACK_HOURS * 60 * 60 * 1000;
  const startIdx = 2; // skip header
  const rows = sh.getRange(startIdx, 1, Math.max(sh.getLastRow() - 1, 0), sh.getLastColumn()).getValues();

  const matches = [];
  for (let i = 0; i < rows.length; i++) {
    const [ts, raw, headers, tag] = rows[i];
    if (!ts) continue;
    try {
      const age = now - new Date(ts);
      if (age < 0 || age > lookbackMs) continue;
    } catch (_e) {
      continue;
    }
    const haystack = [String(tag || ''), String(raw || ''), String(headers || '')].join(' ').toLowerCase();
    if (ERROR_PATTERNS.some(p => haystack.indexOf(p) !== -1)) {
      matches.push({ ts, tag, snippet: String(raw || '').slice(0, 200) });
    }
  }

  if (!matches.length) {
    Logger.log(`Ping monitor: no issues in last ${LOOKBACK_HOURS}h`);
    return 'ok';
  }

  Logger.log(`Ping monitor: found ${matches.length} potential issues in last ${LOOKBACK_HOURS}h`);
  matches.slice(0, 10).forEach(m => {
    Logger.log(`[${m.ts}] tag=${m.tag} raw=${m.snippet}`);
  });
  if (matches.length > 10) Logger.log(`+${matches.length - 10} more...`);
  return matches.length;
}
