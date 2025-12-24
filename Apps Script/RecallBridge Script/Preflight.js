// Preflight.js - validates sheets, headers, config, kill switch

function Preflight(practiceSheetId) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const practiceId = safeConfigPracticeId_(ss);
  logEvent(ss, EVENT_TYPES.PREFLIGHT_START, rid, practiceId, "Preflight start", {});
  try {
    REQUIRED_SHEETS.forEach(function (n) { getSheetByName(ss, n); });
    const cfg = getConfig(ss);
    if (cfg.kill_switch === "ON" && cfg.mode !== "DRY_RUN") {
      throw new Error("Kill switch ON while mode=" + cfg.mode);
    }

    const pHeader = ss.getSheetByName("30_Patients").getRange(1, 1, 1, ss.getSheetByName("30_Patients").getLastColumn()).getValues()[0];
    const qHeader = ss.getSheetByName("50_Queue").getRange(1, 1, 1, ss.getSheetByName("50_Queue").getLastColumn()).getValues()[0];
    const tHeader = ss.getSheetByName("60_Touches").getRange(1, 1, 1, ss.getSheetByName("60_Touches").getLastColumn()).getValues()[0];
    const eHeader = ss.getSheetByName("70_EventLog").getRange(1, 1, 1, ss.getSheetByName("70_EventLog").getLastColumn()).getValues()[0];

    headerMap(pHeader); headerMap(qHeader); headerMap(tHeader); headerMap(eHeader);
    const missing = [];
    const mp = PATIENT_HEADERS.filter(function (h) { return pHeader.indexOf(h) === -1; });
    const mq = QUEUE_HEADERS.filter(function (h) { return qHeader.indexOf(h) === -1; });
    const mt = TOUCHES_HEADERS.filter(function (h) { return tHeader.indexOf(h) === -1; });
    const me = EVENT_HEADERS.filter(function (h) { return eHeader.indexOf(h) === -1; });
    const mc = CONFIG_KEYS.filter(function (k) { return !(k in cfg); });
    if (mp.length) missing.push("Patients missing: " + mp.join(","));
    if (mq.length) missing.push("Queue missing: " + mq.join(","));
    if (mt.length) missing.push("Touches missing: " + mt.join(","));
    if (me.length) missing.push("EventLog missing: " + me.join(","));
    if (mc.length) missing.push("Config missing: " + mc.join(","));
    if (missing.length) throw new Error(missing.join(" | "));

    logEvent(ss, EVENT_TYPES.PREFLIGHT_PASS, rid, practiceId, "Preflight ok", {});
    return true;
  } catch (e) {
    logEvent(ss, EVENT_TYPES.PREFLIGHT_FAIL, rid, practiceId, e.message, {});
    throw e;
  }
}

function safeConfigPracticeId_(ss) {
  try { return getConfig(ss).practice_id || ""; } catch (e) { return ""; }
}
