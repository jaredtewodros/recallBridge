// Refresh.js - compute derived patient fields

function RefreshPatients(practiceSheetId) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id;
  logEvent(ss, EVENT_TYPES.REFRESH_START, rid, practiceId, "Refresh start", {});
  try {
    const sh = getSheetByName(ss, "30_Patients");
    const data = sh.getDataRange().getValues();
    if (data.length < 2) {
      logEvent(ss, EVENT_TYPES.REFRESH_PASS, rid, practiceId, "No patients", {});
      return;
    }
    const header = data[0];
    const hmap = headerMap(header);
    const windowDays = cfg.recall_due_window_days || 30;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const phone = normalizePhone(row[hmap["phone_mobile_raw"]]) ||
        normalizePhone(row[hmap["phone_home_raw"]]) ||
        normalizePhone(row[hmap["phone_work_raw"]]) ||
        normalizePhone(row[hmap["phone_other_raw"]]);
      row[hmap["phone_e164"]] = phone || "";
      row[hmap["has_sms_contact"]] = !!phone;
      row[hmap["recall_status"]] = computeRecallStatus(row[hmap["recall_due_date"]], windowDays);
      row[hmap["updated_at"]] = nowIso();

      ["do_not_text", "complaint_flag"].forEach(function (flag) {
        const idx = hmap[flag];
        if (String(data[i][idx]).toUpperCase() === "TRUE") row[idx] = true;
      });
      data[i] = row;
    }
    sh.getRange(1, 1, data.length, header.length).setValues(data);
    logEvent(ss, EVENT_TYPES.REFRESH_PASS, rid, practiceId, "Refreshed " + (data.length - 1) + " patients", {});
  } catch (e) {
    logEvent(ss, EVENT_TYPES.REFRESH_FAIL, rid, practiceId, e.message, {});
    throw e;
  }
}
