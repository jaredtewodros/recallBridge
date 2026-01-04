// Send.js - hardened send pipeline (two-phase claim/send) using Twilio

function SendReadyTouches(practiceSheetId, touchType, dryRun) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id || "";
  const campaign = cfg.active_campaign_id || "";
  const touch = touchType || "T1";
  const dryFlag = typeof dryRun === "boolean" ? dryRun : true;
  const ks = cfg.kill_switch || "OFF";

  logEvent(ss, EVENT_TYPES.RUN_SEND_START, rid, practiceId, "SendReady start " + touch + " " + campaign, {});
  if (!dryFlag) {
    const msg = "LIVE sending not implemented in this version.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }
  if (ks === "ON") {
    const msg = "Kill switch ON; refusing send.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }
  if (!campaign) {
    const msg = "Set active_campaign_id in Config before sending.";
    logEvent(ss, EVENT_TYPES.RUN_SEND_FAIL, rid, practiceId, msg, {});
    throw new Error(msg);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const tSh = getSheetByName(ss, "60_Touches");
    const data = tSh.getDataRange().getValues();
    if (data.length < 2) {
      logEvent(ss, EVENT_TYPES.RUN_SEND_PASS, rid, practiceId, "No touches to send", { ready_count: 0, sent_count: 0, campaign_id: campaign, touch_type: touch });
      return { ready_count: 0, sent_count: 0 };
    }
    const header = data[0];
    const h = headerMap(header);
    const now = new Date().toISOString();

    const READY = "READY";
    const SENDING = "SENDING";
    const SENT = "SENT";
    const ERROR = "ERROR";
    const SKIPPED = "SKIPPED";

    // Phase 1: claim rows
    const claimed = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if ((row[h["touch_type"]] || "") !== touch) continue;
      if ((row[h["campaign_id"]] || "") !== campaign) continue;
      const state = h["send_state"] !== undefined ? (row[h["send_state"]] || "") : (h["send_status"] !== undefined ? (row[h["send_status"]] || "") : "");
      const sid = h["msg_sid"] !== undefined ? row[h["msg_sid"]] : "";
      const stopAt = h["stop_at"] !== undefined ? row[h["stop_at"]] : "";
      const doNotText = h["do_not_text"] !== undefined ? String(row[h["do_not_text"]]).toUpperCase() === "TRUE" : false;
      // Safety: never claim rows that already recorded STOP/opt-out; mark as skipped for audit clarity
      if (stopAt || doNotText) {
        if (h["send_state"] !== undefined) row[h["send_state"]] = SKIPPED;
        if (h["send_status"] !== undefined) row[h["send_status"]] = SKIPPED;
        if (h["ineligible_reason"] !== undefined) row[h["ineligible_reason"]] = stopAt ? "STOP_RECEIVED" : "DO_NOT_TEXT";
        if (h["updated_at"] !== undefined) row[h["updated_at"]] = now;
        data[i] = row;
        continue;
      }

      // Stuck SENDING guard: if SENDING with no SID and older than 30 min, mark ERROR and skip
      if (state === SENDING && !sid) {
        const planned = row[h["planned_at"]] || now;
        const ageMin = (new Date(now) - new Date(planned)) / 60000;
        if (ageMin > 30) {
          if (h["send_state"] !== undefined) row[h["send_state"]] = ERROR;
          if (h["error_message"] !== undefined) row[h["error_message"]] = "stuck_sending_timeout";
          if (h["updated_at"] !== undefined) row[h["updated_at"]] = now;
          data[i] = row;
        }
        continue;
      }
      if (state === SENT || sid) continue; // already sent
      if (state !== READY) continue;

      // Claim
      const attemptId = Utilities.getUuid();
      if (h["send_state"] !== undefined) row[h["send_state"]] = SENDING;
      if (h["send_status"] !== undefined && !row[h["send_status"]]) row[h["send_status"]] = SENDING;
      if (h["send_attempt_id"] !== undefined) row[h["send_attempt_id"]] = attemptId;
      if (h["planned_at"] !== undefined && !row[h["planned_at"]]) row[h["planned_at"]] = now;
      if (h["updated_at"] !== undefined) row[h["updated_at"]] = now;
      data[i] = row;
      claimed.push({ idx: i, attemptId: attemptId });
    }

    if (claimed.length === 0) {
      tSh.getRange(1, 1, data.length, header.length).setValues(data);
      logEvent(ss, EVENT_TYPES.RUN_SEND_PASS, rid, practiceId, "Nothing to claim", { ready_count: 0, sent_count: 0, campaign_id: campaign, touch_type: touch });
      return { ready_count: 0, sent_count: 0 };
    }

    // Persist claimed state before sending
    tSh.getRange(1, 1, data.length, header.length).setValues(data);
    lock.releaseLock();

    // Phase 2: send (dry-run marks WOULD_SEND; live calls Twilio)
    let sentCount = 0;
    const updatedRows = [];
    const updatedIdx = [];
    const now2 = new Date().toISOString();
    // Map patient_key -> row index for fresh DND lookups
    let patientSheet = null;
    let patientHeader = [];
    let patientHeaderMap = {};
    const patientRowByKey = {};
    if (h["patient_key"] !== undefined) {
      try {
        patientSheet = getSheetByName(ss, "30_Patients");
        patientHeader = patientSheet.getRange(1, 1, 1, patientSheet.getLastColumn()).getValues()[0] || [];
        patientHeaderMap = headerMap(patientHeader);
        if (patientHeaderMap["patient_key"] !== undefined) {
          const keyCol = patientHeaderMap["patient_key"] + 1;
          const rowCount = Math.max(patientSheet.getLastRow() - 1, 0);
          if (rowCount > 0) {
            const keys = patientSheet.getRange(2, keyCol, rowCount, 1).getValues();
            for (let i = 0; i < keys.length; i++) {
              const key = keys[i][0];
              if (key) patientRowByKey[String(key)] = i + 2; // data rows start at 2
            }
          }
        }
      } catch (_e) {
        patientSheet = null;
      }
    }
    claimed.forEach(function (c) {
      // Re-read the live row to catch STOP/do_not_text flags that landed after claim
      let row = data[c.idx];
      if (h["stop_at"] !== undefined || h["do_not_text"] !== undefined) {
        const liveRow = tSh.getRange(c.idx + 1, 1, 1, header.length).getValues()[0];
        const liveStopAt = h["stop_at"] !== undefined ? liveRow[h["stop_at"]] : "";
        const liveDoNotText = h["do_not_text"] !== undefined ? String(liveRow[h["do_not_text"]]).toUpperCase() === "TRUE" : false;
        if (liveStopAt || liveDoNotText) {
          row = liveRow;
          if (h["send_state"] !== undefined) row[h["send_state"]] = SKIPPED;
          if (h["send_status"] !== undefined) row[h["send_status"]] = SKIPPED;
          if (h["ineligible_reason"] !== undefined) row[h["ineligible_reason"]] = liveStopAt ? "STOP_RECEIVED" : "DO_NOT_TEXT";
          if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
          updatedRows.push(row);
          updatedIdx.push(c.idx);
          return;
        }
        row = liveRow; // Use freshest data if sending proceeds
      }
      // Patient-level DND check in case STOP is recorded only on 30_Patients
      if (patientSheet && h["patient_key"] !== undefined && patientRowByKey[String(row[h["patient_key"]])]) {
        const prowIdx = patientRowByKey[String(row[h["patient_key"]])];
        const livePatientRow = patientSheet.getRange(prowIdx, 1, 1, patientHeader.length).getValues()[0];
        const patientDoNotText = patientHeaderMap["do_not_text"] !== undefined ? String(livePatientRow[patientHeaderMap["do_not_text"]]).toUpperCase() === "TRUE" : false;
        if (patientDoNotText) {
          if (h["send_state"] !== undefined) row[h["send_state"]] = SKIPPED;
          if (h["send_status"] !== undefined) row[h["send_status"]] = SKIPPED;
          if (h["ineligible_reason"] !== undefined) row[h["ineligible_reason"]] = "DO_NOT_TEXT";
          if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
          updatedRows.push(row);
          updatedIdx.push(c.idx);
          return;
        }
      }
      if (dryFlag) {
        // Dry-run: no Twilio call
        if (h["send_state"] !== undefined) row[h["send_state"]] = SENT;
        if (h["send_status"] !== undefined) row[h["send_status"]] = "WOULD_SEND";
        if (h["sent_at"] !== undefined) row[h["sent_at"]] = now2;
        if (h["dry_run"] !== undefined) row[h["dry_run"]] = true;
        if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
        updatedRows.push(row);
        updatedIdx.push(c.idx);
        sentCount++;
        return;
      }

      // LIVE: send via Twilio
      const secrets = getTwilioSecretsMap_(practiceId);
      const rawTo = row[h["phone_e164"]];
      const to = (typeof normalizePhone === "function" ? normalizePhone(rawTo) : rawTo);
      // Validate E.164 before calling Twilio; if invalid, mark ERROR without sending.
      if (!to || !/^\+\d{10,15}$/.test(to)) {
        if (h["send_state"] !== undefined) row[h["send_state"]] = ERROR;
        if (h["send_status"] !== undefined) row[h["send_status"]] = "ERROR";
        if (h["error_message"] !== undefined) row[h["error_message"]] = "invalid_phone_e164";
        if (h["error_code"] !== undefined) row[h["error_code"]] = "invalid_phone_e164";
        if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
        updatedRows.push(row);
        updatedIdx.push(c.idx);
        logEvent(ss, EVENT_TYPES.RUN_SEND_FAIL, rid, practiceId, "Invalid phone, skipping send", { touch_id: h["touch_id"] !== undefined ? row[h["touch_id"]] : "", phone: rawTo });
        return;
      }
      const body = defaultSmsBody_(touch, cfg, to, practiceId);
      const statusCallback = cfg.status_callback_url || "";
      const payload = {
        To: to,
        MessagingServiceSid: secrets.messagingServiceSid,
        Body: body,
        ShortenUrls: true
      };
      if (statusCallback) payload.StatusCallback = statusCallback;
      const resp = UrlFetchApp.fetch("https://api.twilio.com/2010-04-01/Accounts/" + secrets.accountSid + "/Messages.json", {
        method: "post",
        payload: payload,
        muteHttpExceptions: true,
        headers: {
          Authorization: "Basic " + Utilities.base64Encode(secrets.accountSid + ":" + secrets.authToken)
        }
      });
      const code = resp.getResponseCode();
      const respObj = safeJsonParse_(resp.getContentText() || "", {});
      if (code >= 200 && code < 300 && respObj.sid) {
        if (h["msg_sid"] !== undefined) row[h["msg_sid"]] = respObj.sid;
        if (h["send_state"] !== undefined) row[h["send_state"]] = SENT;
        if (h["send_status"] !== undefined) row[h["send_status"]] = "SENT";
        if (h["sent_at"] !== undefined) row[h["sent_at"]] = now2;
        if (h["dry_run"] !== undefined) row[h["dry_run"]] = false;
        if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
        updatedRows.push(row);
        updatedIdx.push(c.idx);
        sentCount++;
        logEvent(ss, EVENT_TYPES.RUN_SEND_PASS, rid, practiceId, "Twilio sent", { touch_id: h["touch_id"] !== undefined ? row[h["touch_id"]] : "", twilio_message_sid: respObj.sid });
      } else {
        if (h["send_state"] !== undefined) row[h["send_state"]] = ERROR;
        if (h["send_status"] !== undefined) row[h["send_status"]] = "ERROR";
        if (h["error_message"] !== undefined) row[h["error_message"]] = String(respObj.message || resp.getContentText() || code);
        if (h["error_code"] !== undefined && respObj.code) row[h["error_code"]] = respObj.code;
        if (h["updated_at"] !== undefined) row[h["updated_at"]] = now2;
        updatedRows.push(row);
        updatedIdx.push(c.idx);
        logEvent(ss, EVENT_TYPES.RUN_SEND_FAIL, rid, practiceId, "Twilio send failed", { touch_id: h["touch_id"] !== undefined ? row[h["touch_id"]] : "", response: resp.getContentText(), code: code });
      }
    });
    // Write back updated rows
    updatedIdx.forEach(function (idx, n) {
      tSh.getRange(idx + 1, 1, 1, header.length).setValues([updatedRows[n]]);
    });

    logEvent(ss, EVENT_TYPES.RUN_SEND_PASS, rid, practiceId, "SendReady DRY_RUN", { ready_count: claimed.length, sent_count: sentCount, campaign_id: campaign, touch_type: touch });
    return { ready_count: claimed.length, sent_count: sentCount };
  } finally {
    try { lock.releaseLock(); } catch (_e) {}
  }
}

// Resolve Twilio creds per practice from a JSON map Script Property: RB_TWILIO_CREDS_JSON
// Shape: {"practice_id":{"accountSid":"...","authToken":"...","messagingServiceSid":"..."}, ...}
function getTwilioSecretsMap_(practiceId) {
  const raw = PropertiesService.getScriptProperties().getProperty("RB_TWILIO_CREDS_JSON") || "{}";
  var obj = {};
  try { obj = JSON.parse(raw); } catch (_e) { obj = {}; }
  const entry = obj[practiceId];
  if (!entry || !entry.accountSid || !entry.authToken || !entry.messagingServiceSid) {
    throw new Error("Missing Twilio creds for practice " + practiceId + " in RB_TWILIO_CREDS_JSON");
  }
  return entry;
}

function defaultSmsBody_(touchType, cfg, phoneE164, practiceId) {
  const copy = getPracticeCopy_(practiceId, cfg);
  const officePhone = copy.office_phone || (cfg && cfg.office_phone) || "";
  const baseUrl = copy.booking_url || (cfg && cfg.booking_url) || "https://schedule.solutionreach.com/scheduling/subscriber/79395/scheduler";
  const listTag = "past_due";
  // Build full scheduler URL with list_tag + phone
  const fullUrl = baseUrl + "?lt=" + encodeURIComponent(listTag) + (phoneE164 ? "&pn=" + encodeURIComponent(phoneE164) : "");
  try {
    return renderMessage({
      mode: "link",
      list_tag: listTag,
      first: "",
      office_phone: officePhone,
      touch: touchType || "T1",
      include_opt_out: true,
      short_url: fullUrl,
      practice_name: copy.practice_name
    });
  } catch (_e) {
    return renderMessage({
      mode: "manual",
      list_tag: listTag,
      first: "",
      office_phone: officePhone,
      touch: touchType || "T1",
      include_opt_out: true,
      practice_name: copy.practice_name
    });
  }
}

// Practice-specific copy: read from Script Property RB_PRACTICE_COPY_JSON, keyed by practice_id
// Shape: {"bethesda_dental_smiles":{"practice_name":"Bethesda Dental Smiles","booking_url":"https://...","office_phone":"301-656-7872"}, ...}
function getPracticeCopy_(practiceId, cfg) {
  var map = {};
  var raw = PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_COPY_JSON") || "{}";
  try { map = JSON.parse(raw); } catch (_e) { map = {}; }
  var entry = map[practiceId] || {};
  return {
    practice_name: entry.practice_name || (cfg && cfg.practice_display_name) || "your practice",
    booking_url: entry.booking_url || (cfg && cfg.booking_url) || "",
    office_phone: entry.office_phone || (cfg && cfg.office_phone) || ""
  };
}
