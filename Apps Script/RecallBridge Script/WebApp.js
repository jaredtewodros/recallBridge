// WebApp.js - single webhook entrypoint (Twilio status, clicks, inbound)

function doPost(e) {
  const qs = e && e.parameter ? e.parameter : {};
  const route = (qs.route || "").toLowerCase();
  const practiceId = qs.practice_id || "";
  const token = qs.token || "";
  const expectedToken = PropertiesService.getScriptProperties().getProperty("RB_WEBHOOK_TOKEN") || "";
  const sigToken = PropertiesService.getScriptProperties().getProperty("RB_TWILIO_AUTH_TOKEN") || PropertiesService.getScriptProperties().getProperty("TWILIO_AUTH_TOKEN") || "";

  if (!route || !practiceId) return ContentService.createTextOutput("missing route/practice_id").setMimeType(ContentService.MimeType.TEXT);
  if (!expectedToken || token !== expectedToken) return ContentService.createTextOutput("forbidden").setMimeType(ContentService.MimeType.TEXT);
  if (!validateTwilioSignature_(e, sigToken)) return ContentService.createTextOutput("forbidden").setMimeType(ContentService.MimeType.TEXT);

  const registryJson = PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_REGISTRY_JSON") || "{}";
  const registry = safeJsonParse_(registryJson, {});
  const sheetId = registry[practiceId];
  if (!sheetId) return ContentService.createTextOutput("unknown practice").setMimeType(ContentService.MimeType.TEXT);

  const ss = SpreadsheetApp.openById(sheetId);
  const payload = parseWebhookBody_(e);

  try {
    if (route === "twilio_status") {
      handleTwilioStatus_(ss, practiceId, payload);
    } else if (route === "twilio_click") {
      handleTwilioClick_(ss, practiceId, payload);
    } else if (route === "twilio_inbound") {
      handleTwilioInbound_(ss, practiceId, payload);
    } else {
      return ContentService.createTextOutput("unknown route").setMimeType(ContentService.MimeType.TEXT);
    }
  } catch (err) {
    try { logEvent(ss, EVENT_TYPES.ERROR, runId(), practiceId, "webhook error: " + err.message, payload, { error: String(err) }); } catch (_) {}
  }
  return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
}

function parseWebhookBody_(e) {
  if (!e || !e.postData) return {};
  const ct = (e.postData.type || "").toLowerCase();
  const raw = e.postData.contents || "";
  if (ct.indexOf("application/json") !== -1) {
    const obj = safeJsonParse_(raw, {});
    if (obj && typeof obj === "object") return obj;
  }
  // form-encoded fallback
  return e.parameter || {};
}

function safeJsonParse_(txt, fallback) {
  try { return JSON.parse(txt); } catch (_e) { return fallback; }
}

// Best-effort Twilio signature validation. If signature header is missing or auth token not set, validation is skipped.
function validateTwilioSignature_(e, authToken) {
  if (!authToken) return true;
  const headers = (e && e.headers) || {};
  const sigHeader = headers["X-Twilio-Signature"] || headers["x-twilio-signature"] || (e && e.parameter && (e.parameter["X-Twilio-Signature"] || e.parameter["x-twilio-signature"])) || "";
  if (!sigHeader) return true; // cannot validate without signature

  // Use configured base URL if provided to avoid domain mismatch; fallback to ScriptApp service URL
  const baseUrl = PropertiesService.getScriptProperties().getProperty("RB_WEBHOOK_BASE_URL") || ScriptApp.getService().getUrl();
  const params = e && e.parameter ? e.parameter : {};
  const keys = Object.keys(params || {}).filter(function (k) { return k.toLowerCase() !== "x-twilio-signature"; }).sort();
  const concat = keys.map(function (k) { return k + String(params[k]); }).join("");
  const data = baseUrl + concat;
  const digest = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, data, authToken);
  const computed = Utilities.base64Encode(digest);
  return computed === sigHeader;
}

// ===== Twilio Handlers =====

function handleTwilioStatus_(ss, practiceId, payload) {
  const sid = payload.MessageSid || payload.SmsSid || payload.sms_sid || payload.sid || "";
  const statusRaw = payload.MessageStatus || payload.MessageStatus || payload.message_status || payload.status || "";
  const status = String(statusRaw || "").toLowerCase();
  const errorCode = payload.ErrorCode || payload.error_code || payload.error || "";
  if (!sid) return;
  const dedupeKey = "status:" + sid + ":" + status + ":" + (errorCode || "");
  if (isDuplicateEvent_(ss, dedupeKey)) return;

  const tSh = getSheetByName(ss, "60_Touches");
  const data = tSh.getDataRange().getValues();
  if (data.length < 2) {
    logEvent(ss, EVENT_TYPES.TWILIO_STATUS, runId(), practiceId, "status no touches", payload, { dedupe_key: dedupeKey, twilio_message_sid: sid });
    return;
  }
  const h = headerMap(data[0]);
  const idx = findRowByValue_(data, h["msg_sid"], sid);
  const terminal = { delivered: true, undelivered: true, failed: true };
  let touchId = "";
  if (idx > 0) {
    const row = data[idx];
    touchId = h["touch_id"] !== undefined ? row[h["touch_id"]] : "";
    const curStatus = h["twilio_message_status"] !== undefined ? String(row[h["twilio_message_status"]] || "").toLowerCase() : "";
    if (curStatus && terminal[curStatus] && !terminal[status]) {
      // do not downgrade terminal
    } else {
      if (h["twilio_message_status"] !== undefined) row[h["twilio_message_status"]] = status;
      if (h["error_code"] !== undefined && errorCode) row[h["error_code"]] = errorCode;
      const now = new Date().toISOString();
      if (status === "delivered" && h["delivered_at"] !== undefined && !row[h["delivered_at"]]) row[h["delivered_at"]] = now;
      if (status === "undelivered" && h["undelivered_at"] !== undefined && !row[h["undelivered_at"]]) row[h["undelivered_at"]] = now;
      if (status === "failed" && h["failed_at"] !== undefined && !row[h["failed_at"]]) row[h["failed_at"]] = now;
      if (h["send_state"] !== undefined && status === "delivered") row[h["send_state"]] = "SENT";
      if (h["send_status"] !== undefined && status === "delivered" && row[h["send_status"]] === "WOULD_SEND") row[h["send_status"]] = "SENT";
      row[h["updated_at"]] = now;
      data[idx] = row;
      tSh.getRange(idx + 1, 1, 1, data[0].length).setValues([row]);
    }
  }
  logEvent(ss, EVENT_TYPES.TWILIO_STATUS, runId(), practiceId, "status " + status, payload, { dedupe_key: dedupeKey, twilio_message_sid: sid, touch_id: touchId });
}

function handleTwilioClick_(ss, practiceId, payload) {
  const sid = payload.sms_sid || payload.MessageSid || payload.SmsSid || "";
  const eventType = String(payload.event_type || payload.EventType || "").toLowerCase();
  const clickTime = payload.click_time || payload.ClickTime || payload.event_time || "";
  if (!sid) return;
  const dedupeKey = "click:" + sid + ":" + eventType + ":" + (clickTime || "");
  if (isDuplicateEvent_(ss, dedupeKey)) return;

  const tSh = getSheetByName(ss, "60_Touches");
  const data = tSh.getDataRange().getValues();
  let touchId = "";
  if (data.length >= 2) {
    const h = headerMap(data[0]);
    const idx = findRowByValue_(data, h["msg_sid"], sid);
    if (idx > 0) {
      const row = data[idx];
      touchId = h["touch_id"] !== undefined ? row[h["touch_id"]] : "";
      const now = clickTime || new Date().toISOString();
      if (eventType === "click") {
        if (h["click_count"] !== undefined) row[h["click_count"]] = Number(row[h["click_count"]] || 0) + 1;
        if (h["first_clicked_at"] !== undefined && !row[h["first_clicked_at"]]) row[h["first_clicked_at"]] = now;
        if (h["last_clicked_at"] !== undefined) row[h["last_clicked_at"]] = now;
      } else if (eventType === "preview") {
        if (h["preview_count"] !== undefined) row[h["preview_count"]] = Number(row[h["preview_count"]] || 0) + 1;
      }
      row[h["updated_at"]] = new Date().toISOString();
      data[idx] = row;
      tSh.getRange(idx + 1, 1, 1, data[0].length).setValues([row]);
    }
  }
  logEvent(ss, EVENT_TYPES.TWILIO_CLICK, runId(), practiceId, "click " + eventType, payload, { dedupe_key: dedupeKey, twilio_message_sid: sid, touch_id: touchId });
}

function handleTwilioInbound_(ss, practiceId, payload) {
  const bodyRaw = payload.Body || payload.body || "";
  const fromRaw = payload.From || payload.from || "";
  const msgSid = payload.MessageSid || payload.SmsSid || "";
  const dedupeKey = "inbound:" + (msgSid || "") + ":" + (fromRaw || "") + ":" + (bodyRaw || "");
  if (isDuplicateEvent_(ss, dedupeKey)) return;

  const body = String(bodyRaw || "").trim();
  const upper = body.toUpperCase();
  const stopWords = ["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"];
  const isStop = stopWords.indexOf(upper) !== -1;
  const isHelp = upper === "HELP";
  const phone = normalizePhone(fromRaw) || fromRaw;

  let patientRowIdx = -1;
  let pMap = {};
  let pHeader = [];
  try {
    const pSh = getSheetByName(ss, "30_Patients");
    const pData = pSh.getDataRange().getValues();
    pHeader = pData[0];
    pMap = headerMap(pHeader);
    for (let i = 1; i < pData.length; i++) {
      if ((pData[i][pMap["phone_e164"]] || "") === phone) { patientRowIdx = i; break; }
    }
    if (patientRowIdx > 0 && isStop) {
      const row = pData[patientRowIdx];
      row[pMap["do_not_text"]] = true;
      if (pMap["do_not_text_source"] !== undefined) row[pMap["do_not_text_source"]] = "STOP";
      if (pMap["do_not_text_at"] !== undefined) row[pMap["do_not_text_at"]] = new Date().toISOString();
      row[pMap["updated_at"]] = new Date().toISOString();
      pSh.getRange(patientRowIdx + 1, 1, 1, pHeader.length).setValues([row]);
    } else if (patientRowIdx > 0 && !isStop && !isHelp) {
      const row = pData[patientRowIdx];
      if (pMap["updated_at"] !== undefined) row[pMap["updated_at"]] = new Date().toISOString();
      pSh.getRange(patientRowIdx + 1, 1, 1, pHeader.length).setValues([row]);
    }
  } catch (_e) {}

  // Update touches for reply/stop
  try {
    const tSh = getSheetByName(ss, "60_Touches");
    const tData = tSh.getDataRange().getValues();
    if (tData.length >= 2) {
      const h = headerMap(tData[0]);
      for (let i = 1; i < tData.length; i++) {
        const row = tData[i];
        if ((row[h["phone_e164"]] || "") !== phone) continue;
        if (isStop && h["stop_at"] !== undefined && !row[h["stop_at"]]) row[h["stop_at"]] = new Date().toISOString();
        if (!isStop && !isHelp && h["reply_at"] !== undefined && !row[h["reply_at"]]) row[h["reply_at"]] = new Date().toISOString();
        if (h["last_inbound_body"] !== undefined) row[h["last_inbound_body"]] = body.substring(0, 160);
        row[h["updated_at"]] = new Date().toISOString();
        tSh.getRange(i + 1, 1, 1, tData[0].length).setValues([row]);
        break; // update most recent match
      }
    }
  } catch (_e) {}

  logEvent(ss, EVENT_TYPES.TWILIO_INBOUND, runId(), practiceId, isStop ? "STOP" : (isHelp ? "HELP" : "REPLY"), payload, { dedupe_key: dedupeKey, twilio_message_sid: msgSid });
}

// ===== helpers =====
function isDuplicateEvent_(ss, dedupeKey) {
  if (!dedupeKey) return false;
  const sh = getSheetByName(ss, "70_EventLog");
  const data = sh.getDataRange().getValues();
  if (!data.length) return false;
  const h = headerMap(data[0]);
  if (h["dedupe_key"] === undefined) return false;
  for (let i = Math.max(1, data.length - 500); i < data.length; i++) {
    if ((data[i][h["dedupe_key"]] || "") === dedupeKey) return true;
  }
  return false;
}

function findRowByValue_(data, colIdx, value) {
  if (colIdx === undefined) return -1;
  for (let i = 1; i < data.length; i++) {
    if ((data[i][colIdx] || "") === value) return i;
  }
  return -1;
}

// ===== Test helpers =====
function SimulateTwilioStatusWebhook(practiceId, messageSid, messageStatus, errorCode) {
  const registry = safeJsonParse_(PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_REGISTRY_JSON") || "{}", {});
  const sheetId = registry[practiceId];
  if (!sheetId) throw new Error("unknown practice_id");
  const ss = SpreadsheetApp.openById(sheetId);
  handleTwilioStatus_(ss, practiceId, { MessageSid: messageSid, MessageStatus: messageStatus, ErrorCode: errorCode });
}

function SimulateTwilioClickWebhook(practiceId, messageSid, eventType, clickTime) {
  const registry = safeJsonParse_(PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_REGISTRY_JSON") || "{}", {});
  const sheetId = registry[practiceId];
  if (!sheetId) throw new Error("unknown practice_id");
  const ss = SpreadsheetApp.openById(sheetId);
  handleTwilioClick_(ss, practiceId, { sms_sid: messageSid, event_type: eventType, click_time: clickTime });
}

function SimulateTwilioInboundWebhook(practiceId, from, body) {
  const registry = safeJsonParse_(PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_REGISTRY_JSON") || "{}", {});
  const sheetId = registry[practiceId];
  if (!sheetId) throw new Error("unknown practice_id");
  const ss = SpreadsheetApp.openById(sheetId);
  handleTwilioInbound_(ss, practiceId, { From: from, Body: body });
}

// Creates a single test touch to the TEST_TO_E164 number and returns instructions; if live=true asserts msg_sid + SENT
function RunWebhookE2ETest(practiceId, touchType, campaignId, live) {
  const registry = safeJsonParse_(PropertiesService.getScriptProperties().getProperty("RB_PRACTICE_REGISTRY_JSON") || "{}", {});
  const sheetId = registry[practiceId];
  if (!sheetId) throw new Error("unknown practice_id");
  const testTo = PropertiesService.getScriptProperties().getProperty("TEST_TO_E164");
  if (!testTo) throw new Error("TEST_TO_E164 Script Property is required for this helper");

  const ss = SpreadsheetApp.openById(sheetId);
  const tSh = getSheetByName(ss, "60_Touches");
  const data = tSh.getDataRange().getValues();
  const header = data[0];
  const h = headerMap(header);
  const now = new Date().toISOString();
  const touch = touchType || "T1";
  const campaign = campaignId || "webhook_e2e";
  const pk = "test_" + Utilities.getUuid();
  const tid = sha256Hex(practiceId + ":" + campaign + ":" + pk + ":" + touch);

  const row = new Array(header.length).fill("");
  row[h["touch_id"]] = tid;
  row[h["practice_id"]] = practiceId;
  row[h["campaign_id"]] = campaign;
  row[h["touch_type"]] = touch;
  row[h["patient_key"]] = pk;
  row[h["phone_e164"]] = testTo;
  row[h["eligible"]] = true;
  row[h["ineligible_reason"]] = "";
  row[h["planned_at"]] = now;
  if (h["send_status"] !== undefined) row[h["send_status"]] = "READY";
  if (h["send_state"] !== undefined) row[h["send_state"]] = "READY";
  if (h["send_attempt_id"] !== undefined) row[h["send_attempt_id"]] = "";
  if (h["dry_run"] !== undefined) row[h["dry_run"]] = true;
  if (h["msg_sid"] !== undefined) row[h["msg_sid"]] = "";
  if (h["twilio_message_status"] !== undefined) row[h["twilio_message_status"]] = "";
  if (h["sent_at"] !== undefined) row[h["sent_at"]] = "";
  if (h["error_code"] !== undefined) row[h["error_code"]] = "";
  if (h["error_message"] !== undefined) row[h["error_message"]] = "";
  if (h["delivered_at"] !== undefined) row[h["delivered_at"]] = "";
  if (h["undelivered_at"] !== undefined) row[h["undelivered_at"]] = "";
  if (h["failed_at"] !== undefined) row[h["failed_at"]] = "";
  if (h["click_count"] !== undefined) row[h["click_count"]] = 0;
  if (h["preview_count"] !== undefined) row[h["preview_count"]] = 0;
  if (h["first_clicked_at"] !== undefined) row[h["first_clicked_at"]] = "";
  if (h["last_clicked_at"] !== undefined) row[h["last_clicked_at"]] = "";
  if (h["stop_at"] !== undefined) row[h["stop_at"]] = "";
  if (h["reply_at"] !== undefined) row[h["reply_at"]] = "";
  if (h["last_inbound_body"] !== undefined) row[h["last_inbound_body"]] = "";
  row[h["created_at"]] = now;
  row[h["updated_at"]] = now;

  tSh.appendRow(row);
  // normalize font weight on data row
  tSh.getRange(tSh.getLastRow(), 1, 1, header.length).setFontWeight("normal");

  // Kick off send pipeline (DRY_RUN unless live=true)
  const liveFlag = live === true;
  SendReadyTouches(sheetId, touch, !liveFlag);

  // If live, poll for msg_sid and SENT
  if (liveFlag) {
    var found = false;
    for (var attempt = 0; attempt < 10; attempt++) {
      Utilities.sleep(2000);
      const fresh = tSh.getDataRange().getValues();
      const h2 = headerMap(fresh[0]);
      const idx = findRowByValue_(fresh, h2["touch_id"], tid);
      if (idx > 0) {
        const row = fresh[idx];
        const sid = h2["msg_sid"] !== undefined ? row[h2["msg_sid"]] : "";
        const state = h2["send_state"] !== undefined ? row[h2["send_state"]] : (h2["send_status"] !== undefined ? row[h2["send_status"]] : "");
        if (sid && (state === "SENT" || state === "WOULD_SEND")) { found = true; break; }
      }
    }
    if (!found) throw new Error("Live E2E send did not reach SENT with msg_sid within polling window");
  }

  const instructions = [
    "Test touch created to " + testTo + " with campaign_id=" + campaign + " and touch_type=" + touch + ".",
    liveFlag ? "Send pipeline executed (LIVE)." : "Send pipeline executed (DRY_RUN).",
    "Manual steps:",
    "  1) When the SMS arrives, click the shortened link to trigger a click callback.",
    "  2) Reply STOP to trigger inbound STOP handling.",
    "Verify: Touches shows twilio_message_status/delivery timestamps, click_count/first/last clicked, stop_at/reply_at; Patients.do_not_text=TRUE and do_not_text_source=STOP; EventLog contains dedupe_key rows."
  ].join("\n");
  Logger.log(instructions);
  return instructions;
}

// ===== Runbook (manual steps) =====
// 1) Publish this project as a Web App (Deploy > New Deployment > Web app) and note the /exec URL.
// 2) Set Script Properties:
//    - RB_WEBHOOK_TOKEN: shared secret required on all webhook URLs
//    - RB_PRACTICE_REGISTRY_JSON: JSON map {"practice_id":"spreadsheetId", ...}
// 3) Twilio wiring (per practice_id):
//    Status callback (per-message): use URL
//      <exec_url>?route=twilio_status&practice_id=<pid>&token=<RB_WEBHOOK_TOKEN>
//    Click callback (Messaging Service Link Shortening):
//      <exec_url>?route=twilio_click&practice_id=<pid>&token=<RB_WEBHOOK_TOKEN>
//    Inbound SMS (phone number webhook or Messaging Service):
//      <exec_url>?route=twilio_inbound&practice_id=<pid>&token=<RB_WEBHOOK_TOKEN>
// 4) Optional dry E2E without Twilio: use simulate helpers from Apps Script editor:
//    - SimulateTwilioStatusWebhook(practice_id, messageSid, status, errorCode)
//    - SimulateTwilioClickWebhook(practice_id, messageSid, eventType, clickTime)
//    - SimulateTwilioInboundWebhook(practice_id, fromE164, body)
// 5) Live E2E test: Run SendReadyTouches (DRY_RUN or LIVE when enabled), wait for status/click/inbound, verify 60_Touches and 30_Patients update, and EventLog rows have dedupe_key populated.
