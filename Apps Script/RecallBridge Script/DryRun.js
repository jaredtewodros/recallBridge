// DryRun.js - orchestrated dry run (Import + Refresh + Queue + Invariants)

function DryRunImportRefreshQueue(practiceSheetId) {
  const rid = runId(); // reuse helper
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id || "";
  logEvent(ss, EVENT_TYPES.RUN_DRY_RUN_START, rid, practiceId, "Dry run start", {});
  try {
    ImportLatestDentrixOut(practiceSheetId);
    ImportDentrixFromRaw(practiceSheetId);
    RefreshPatients(practiceSheetId);
    BuildQueue(practiceSheetId, "T1");
    const stats = computeStatsFromSheets(practiceSheetId);
    logRunSummary(practiceSheetId, rid, "DRY_RUN", stats);
    AssertInvariants(practiceSheetId, rid, stats);
    logEvent(ss, EVENT_TYPES.RUN_DRY_RUN_PASS, rid, practiceId, "Dry run pass", {});
    return stats;
  } catch (e) {
    logEvent(ss, EVENT_TYPES.RUN_DRY_RUN_FAIL, rid, practiceId, "Dry run fail: " + e.message, {});
    logEvent(ss, EVENT_TYPES.ERROR, rid, practiceId, "Dry run error", { error: String(e), stack: e && e.stack ? e.stack : "" });
    throw e;
  }
}
