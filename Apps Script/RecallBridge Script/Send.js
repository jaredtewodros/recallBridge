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

    // Phase 1: claim rows
    const claimed = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if ((row[h["touch_type"]] || "") !== touch) continue;
      if ((row[h["campaign_id"]] || "") !== campaign) continue;
      const state = h["send_state"] !== undefined ? (row[h["send_state"]] || "") : (h["send_status"] !== undefined ? (row[h["send_status"]] || "") : "");
      const sid = h["msg_sid"] !== undefined ? row[h["msg_sid"]] : "";

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
    claimed.forEach(function (c) {
      const row = data[c.idx];
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
      const body = defaultSmsBody_(touch, cfg);
      const statusCallback = cfg.status_callback_url || "";
      const payload = {
        To: to,
        MessagingServiceSid: secrets.messagingServiceSid,
        Body: body
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

function defaultSmsBody_(touchType, cfg) {
  const officePhone = (cfg && cfg.office_phone) || "";
  // For now use manual mode copy without a link; extend later if short_url is available.
  return renderMessage({
    mode: "manual",
    list_tag: "past_due",
    first: "",
    office_phone: officePhone,
    touch: touchType || "T1",
    include_opt_out: true
  });
}
