// Touches.js - create touches from queue and mark ready touches (dry run only)

function CreateTouchesFromQueue(practiceSheetId, touchType, campaignId, dryRun) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id || "";
  const mode = cfg.mode || "DRY_RUN";
  const ks = cfg.kill_switch || "OFF";
  const campaign = campaignId || cfg.active_campaign_id || "";
  const touch = touchType || "T1";
  const dryFlag = typeof dryRun === "boolean" ? dryRun : normalizeBool(cfg.touches_dry_run_default || true);

  logEvent(ss, EVENT_TYPES.RUN_CREATE_TOUCHES_START, rid, practiceId, "CreateTouches " + touch + " " + campaign, {});
  if (ks === "ON" && mode !== "DRY_RUN") {
    const msg = "Kill switch ON while mode=" + mode;
    logEvent(ss, EVENT_TYPES.RUN_CREATE_TOUCHES_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }
  if (!campaign) {
    const msg = "active_campaign_id is required in Config or as argument.";
    logEvent(ss, EVENT_TYPES.RUN_CREATE_TOUCHES_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }

  try {
    const qSh = getSheetByName(ss, "50_Queue");
    const tSh = getSheetByName(ss, "60_Touches");
    const qData = qSh.getDataRange().getValues();
    let tData = tSh.getDataRange().getValues();
    // Ensure header exists
    if (!tData.length || (tData[0] || []).every(function (c) { return String(c || "").trim() === ""; })) {
      tSh.clear();
      tSh.appendRow(TOUCHES_HEADERS);
      tSh.setFrozenRows(1);
      tData = tSh.getDataRange().getValues();
    }
    const qHeader = qData[0];
    const tHeader = tData[0];
    const qMap = headerMap(qHeader);
    const tMap = headerMap(tHeader);

    const now = new Date().toISOString();

    // Build existing touch_id map
    const existingMap = {};
    for (let i = 1; i < tData.length; i++) {
      const row = tData[i];
      const tid = row[tMap["touch_id"]];
      if (tid) existingMap[tid] = i; // index in tData
    }

    let created = 0, updated = 0, ready = 0, skipped = 0, existing = Object.keys(existingMap).length;
    const newRows = [];

    for (let i = 1; i < qData.length; i++) {
      const row = qData[i];
      const pk = row[qMap["patient_key"]];
      if (!pk) continue;
      const phone = row[qMap["phone_e164"]] || "";
      const eligible = normalizeBool(row[qMap["eligible"]]);
      const reason = (row[qMap["ineligible_reason"]] || "").toString();
      const status = eligible && phone ? "READY" : "SKIPPED";
      if (status === "READY") ready++; else skipped++;
      const tid = sha256Hex(practiceId + ":" + campaign + ":" + pk + ":" + touch);

      if (existingMap.hasOwnProperty(tid)) {
        const idx = existingMap[tid];
        const tRow = tData[idx];
        const curStatus = tRow[tMap["send_status"]];
        // If already WOULD_SEND or SENT, leave as-is
        if (curStatus === "WOULD_SEND" || curStatus === "SENT") continue;
        // Update basics
        tRow[tMap["phone_e164"]] = phone;
        tRow[tMap["eligible"]] = eligible;
        tRow[tMap["ineligible_reason"]] = reason;
        tRow[tMap["planned_at"]] = now;
        tRow[tMap["updated_at"]] = now;
        // Only adjust send_status if currently READY/SKIPPED
        if (curStatus === "READY" || curStatus === "SKIPPED" || !curStatus) {
          tRow[tMap["send_status"]] = status;
        }
        tData[idx] = tRow;
        updated++;
      } else {
        const newRow = new Array(tHeader.length).fill("");
        newRow[tMap["touch_id"]] = tid;
        newRow[tMap["practice_id"]] = practiceId;
        newRow[tMap["campaign_id"]] = campaign;
        newRow[tMap["touch_type"]] = touch;
        newRow[tMap["patient_key"]] = pk;
        newRow[tMap["phone_e164"]] = phone;
        newRow[tMap["eligible"]] = eligible;
        newRow[tMap["ineligible_reason"]] = reason;
        newRow[tMap["planned_at"]] = now;
        newRow[tMap["send_status"]] = status;
        newRow[tMap["dry_run"]] = dryFlag;
        newRow[tMap["msg_sid"]] = "";
        newRow[tMap["sent_at"]] = "";
        newRow[tMap["error_code"]] = "";
        newRow[tMap["error_message"]] = "";
        newRow[tMap["created_at"]] = now;
        newRow[tMap["updated_at"]] = now;
        newRows.push(newRow);
        created++;
      }
    }

    // Rewrite existing data only if updates happened
    if (updated > 0) {
      tSh.getRange(1,1,tData.length, tHeader.length).setValues(tData);
      if (tData.length > 1) {
        tSh.getRange(2,1,tData.length-1, tHeader.length).setFontWeight("normal");
      }
    }
    if (newRows.length) {
      const startRow = tSh.getLastRow() + 1;
      const needed = startRow + newRows.length - 1;
      if (needed > tSh.getMaxRows()) {
        tSh.insertRowsAfter(tSh.getMaxRows(), needed - tSh.getMaxRows());
      }
      const writeRange = tSh.getRange(startRow, 1, newRows.length, tHeader.length);
      writeRange.setValues(newRows);
      writeRange.setFontWeight("normal");
    }

    const payload = {
      queue_rows: qData.length - 1,
      touches_existing: existing,
      touches_created: created,
      touches_updated: updated,
      touches_ready: ready,
      touches_skipped: skipped,
      campaign_id: campaign,
      touch_type: touch
    };
    logEvent(ss, EVENT_TYPES.RUN_CREATE_TOUCHES_PASS, rid, practiceId, "CreateTouches " + touch + " " + campaign, payload);
    return payload;
  } catch (e) {
    logEvent(ss, EVENT_TYPES.RUN_CREATE_TOUCHES_FAIL, rid, practiceId, "CreateTouches error: " + e.message, { error: String(e), stack: e && e.stack ? e.stack : "" });
    throw e;
  }
}

function SendReadyTouches(practiceSheetId, touchType, dryRun) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id || "";
  const campaign = cfg.active_campaign_id || "";
  const touch = touchType || "T1";
  const dryFlag = typeof dryRun === "boolean" ? dryRun : true;
  const ks = cfg.kill_switch || "OFF";

  logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_START, rid, practiceId, "SendReady " + touch + " " + campaign, {});
  if (!dryFlag) {
    const msg = "LIVE sending not implemented in this version.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }
  if (ks === "ON") {
    const msg = "Kill switch ON; refusing send.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }
  if (!campaign) {
    const msg = "Set active_campaign_id in Config before sending.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }

  try {
    const tSh = getSheetByName(ss, "60_Touches");
    const data = tSh.getDataRange().getValues();
    if (data.length < 2) {
      logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_PASS, rid, practiceId, "No touches to send", { ready_count: 0, would_send_count: 0, campaign_id: campaign, touch_type: touch });
      return { ready_count: 0, would_send_count: 0 };
    }
    const header = data[0];
    const hmap = headerMap(header);
    const now = new Date().toISOString();
    let readyCount = 0;
    let wouldSend = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if ((row[hmap["touch_type"]] || "") !== touch) continue;
      if ((row[hmap["campaign_id"]] || "") !== campaign) continue;
      const status = row[hmap["send_status"]] || "";
      if (status === "READY") {
        readyCount++;
        row[hmap["send_status"]] = "WOULD_SEND";
        row[hmap["sent_at"]] = now;
        row[hmap["updated_at"]] = now;
        row[hmap["dry_run"]] = true;
        data[i] = row;
        wouldSend++;
      }
    }
    if (wouldSend > 0) {
      tSh.getRange(1,1,data.length, header.length).setValues(data);
    }
    const payload = { ready_count: readyCount, would_send_count: wouldSend, campaign_id: campaign, touch_type: touch };
    logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_PASS, rid, practiceId, "SendReady DRY_RUN", payload);
    return payload;
  } catch (e) {
    logEvent(ss, EVENT_TYPES.RUN_SEND_DRY_RUN_FAIL, rid, practiceId, "SendReady error: " + e.message, { error: String(e), stack: e && e.stack ? e.stack : "" });
    throw e;
  }
}
