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
        if (tMap["send_state"] !== undefined) tRow[tMap["send_state"]] = status;
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
        if (tMap["send_state"] !== undefined) newRow[tMap["send_state"]] = status;
        if (tMap["send_attempt_id"] !== undefined) newRow[tMap["send_attempt_id"]] = "";
        newRow[tMap["dry_run"]] = dryFlag;
        newRow[tMap["msg_sid"]] = "";
        if (tMap["twilio_message_status"] !== undefined) newRow[tMap["twilio_message_status"]] = "";
        newRow[tMap["sent_at"]] = "";
        if (tMap["error_code"] !== undefined) newRow[tMap["error_code"]] = "";
        if (tMap["error_message"] !== undefined) newRow[tMap["error_message"]] = "";
        if (tMap["delivered_at"] !== undefined) newRow[tMap["delivered_at"]] = "";
        if (tMap["undelivered_at"] !== undefined) newRow[tMap["undelivered_at"]] = "";
        if (tMap["failed_at"] !== undefined) newRow[tMap["failed_at"]] = "";
        if (tMap["click_count"] !== undefined) newRow[tMap["click_count"]] = 0;
        if (tMap["preview_count"] !== undefined) newRow[tMap["preview_count"]] = 0;
        if (tMap["first_clicked_at"] !== undefined) newRow[tMap["first_clicked_at"]] = "";
        if (tMap["last_clicked_at"] !== undefined) newRow[tMap["last_clicked_at"]] = "";
        if (tMap["stop_at"] !== undefined) newRow[tMap["stop_at"]] = "";
        if (tMap["reply_at"] !== undefined) newRow[tMap["reply_at"]] = "";
        if (tMap["last_inbound_body"] !== undefined) newRow[tMap["last_inbound_body"]] = "";
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
