// Utils.js - helpers

function runId() {
  return Utilities.getUuid();
}

function nowIso() {
  return new Date().toISOString();
}

function toHex(byteArr) {
  return byteArr.map(function (b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
  }).join("");
}

function sha256Hex(str) {
  return toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}

function headerMap(headerRow) {
  const map = {};
  headerRow.forEach(function (h, idx) {
    if (h === "" || h === null || h === undefined) return;
    if (map[h] !== undefined) {
      throw new Error("Duplicate header: " + h);
    }
    map[h] = idx;
  });
  return map;
}

function getSheetByName(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) {
    throw new Error("Missing sheet: " + name);
  }
  return sh;
}

function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function computeRecallStatus(dueDateStr, windowDays) {
  if (!dueDateStr) return "UNKNOWN";
  const d = new Date(dueDateStr);
  if (isNaN(d)) return "UNKNOWN";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + Number(windowDays || 30));
  if (d < today) return "OVERDUE";
  if (d >= today && d <= end) return "DUE";
  return "NOT_DUE";
}

function appendRows(sh, rows) {
  if (!rows || !rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
