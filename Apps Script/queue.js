// Queue.js - build outbound queue

function BuildQueue(practiceSheetId, touch_type) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id;
  logEvent(ss, EVENT_TYPES.QUEUE_START, rid, practiceId, "Queue start", {});
  try {
    const pSh = getSheetByName(ss, "30_Patients");
    const data = pSh.getDataRange().getValues();
    if (data.length < 2) throw new Error("No patients");
    const header = data[0];
    const hmap = headerMap(header);
    const rows = [];
    const windowDays = cfg.recall_due_window_days || 30;
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      const pk = r[hmap["patient_key"]];
      if (!pk) continue;
      const phone = r[hmap["phone_e164"]];
      const doNot = String(r[hmap["do_not_text"]]).toUpperCase() === "TRUE";
      const complaint = String(r[hmap["complaint_flag"]]).toUpperCase() === "TRUE";
      const recallDue = r[hmap["recall_due_date"]];
      const status = computeRecallStatus(recallDue, windowDays);
      let eligible = true;
      let reason = "";
      if (!phone) { eligible = false; reason = "NO_PHONE"; }
      else if (doNot) { eligible = false; reason = "DO_NOT_TEXT"; }
      else if (complaint) { eligible = false; reason = "COMPLAINT"; }
      else if (["DUE", "OVERDUE"].indexOf(status) === -1) { eligible = false; reason = "NOT_IN_WINDOW"; }
      rows.push([
        "campaign_jan_recall",
        touch_type || "T1",
        pk,
        phone || "",
        eligible,
        reason,
        recallDue || "",
        status,
        doNot,
        nowIso()
      ]);
    }
    const qSh = getSheetByName(ss, "50_Queue");
    qSh.clearContents();
    qSh.getRange(1, 1, 1, QUEUE_HEADERS.length).setValues([QUEUE_HEADERS]);
    if (rows.length) qSh.getRange(2, 1, rows.length, QUEUE_HEADERS.length).setValues(rows);
    logEvent(ss, EVENT_TYPES.QUEUE_PASS, rid, practiceId, "Queued " + rows.length + " rows", {});
  } catch (e) {
    logEvent(ss, EVENT_TYPES.QUEUE_FAIL, rid, practiceId, e.message, {});
    throw e;
  }
}
