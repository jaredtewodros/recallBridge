// Path: /twilio-click
// Runtime: Node 18
// Purpose: Forward click webhook to GAS /exec via proxy header (retry on GAS 5xx only).
// Visibility: Protected (Twilio edge validates signature). Proxy failure logs avoid
// sensitive payload; From/To are redacted.
// Required env: RB_WEBHOOK_TOKEN, RB_PROXY_TOKEN, GAS_EXEC_URL, (optional) RB_BUILD_ID.
console.warn("SECURITY: Function must remain Protected visibility; do not set Public.");
const RB_BUILD_ID = process.env.RB_BUILD_ID || "2026-01-04T00:00:00Z";

exports.handler = async function (context, event, callback) {
  console.log("Click Proxy Hit", {
    practice_id: event.practice_id || "missing",
    type: event.EventType,
    sid: event.MessageSid || event.SmsSid,
    build: RB_BUILD_ID
  });
  const practiceId = event.practice_id || event.practiceId || "";
  const webhookToken = context.RB_WEBHOOK_TOKEN || "";
  const proxyToken = context.RB_PROXY_TOKEN || "";
  const gasExec = context.GAS_EXEC_URL || "";
  const forwardUrl = buildForwardUrl(gasExec, "twilio_click", practiceId, webhookToken);

  if (!forwardUrl || !proxyToken) {
    console.error("Misconfigured: Missing GAS_EXEC_URL, RB_WEBHOOK_TOKEN, or RB_PROXY_TOKEN", { build: RB_BUILD_ID });
    // Do not retry config errors.
    return callback(null, plainResponse(200, "misconfigured_no_retry"));
  }

  const payload = buildForwardPayload(event);

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-RB-Proxy-Token": proxyToken
  };

  try {
    const res = await fetch(forwardUrl, { method: "POST", headers, body: payload.toString() });
    const body = await res.text();
    console.log("GAS Response:", { status: res.status, len: body.length, build: RB_BUILD_ID });
    const isGasErrorBody = body && (body.startsWith("<!DOCTYPE html>") || body.indexOf("<title>Error</title>") !== -1);
    // Retry only on 5xx or 200 with GAS error HTML.
    if (res.status >= 500 || (res.status === 200 && isGasErrorBody)) {
      console.error("GAS error - Triggering Retry", { status: res.status, isGasErrorBody: isGasErrorBody, build: RB_BUILD_ID });
      return callback(null, plainResponse(500, "gas_server_error"));
    }
    const bodyLower = (body || "").toLowerCase();
    const isConfigErrorBody = bodyLower.indexOf("forbidden") === 0 || bodyLower.indexOf("unknown practice") === 0 || bodyLower.indexOf("unknown route") === 0;
    if (res.status >= 400) {
      await logProxyFailure(context, event, res.status, body);
      return callback(null, plainResponse(200, "ok"));
    }
    if (isConfigErrorBody) {
      await logProxyFailure(context, event, 200, body);
      return callback(null, plainResponse(200, "ok"));
    }
    return callback(null, plainResponse(200, "ok"));
  } catch (err) {
    console.error("Forwarding failed", { error: err && err.message ? err.message : String(err), build: RB_BUILD_ID });
    // Network failure: allow retry.
    return callback(null, plainResponse(500, "proxy_network_error"));
  }
};

function buildForwardPayload(event) {
  const payload = new URLSearchParams();
  Object.keys(event || {}).forEach(k => {
    if (!shouldForwardKey(k)) return;
    if (!isPrimitive_(event[k])) return;
    payload.append(k, event[k]);
  });
  return payload;
}

function buildForwardUrl(gasExec, route, practiceId, webhookToken) {
  if (!gasExec || !practiceId || !webhookToken) return "";
  return `${gasExec}?route=${route}&practice_id=${encodeURIComponent(practiceId)}&token=${encodeURIComponent(webhookToken)}`;
}

async function logProxyFailure(context, event, status, body) {
  try {
    const proxyToken = context.RB_PROXY_TOKEN || "";
    const gasExec = context.GAS_EXEC_URL || "";
    const practiceId = event.practice_id || event.practiceId || "";
    if (!proxyToken || !gasExec || !practiceId) return;
    const logUrl = `${gasExec}?route=proxy_failure&practice_id=${encodeURIComponent(practiceId)}`;
    const payload = new URLSearchParams();
    payload.append("proxy_status", String(status));
    payload.append("proxy_body", (body || "").substring(0, 1024));
    const fromRed = redactPhone(event.From || event.from || "");
    const toRed = redactPhone(event.To || event.to || "");
    if (fromRed) payload.append("from_redacted", fromRed);
    if (toRed) payload.append("to_redacted", toRed);
    Object.keys(event || {}).forEach(k => {
      if (!shouldForwardKeyForFailure(k)) return;
      if (!isPrimitive_(event[k])) return;
      payload.append(k, event[k]);
    });
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-RB-Proxy-Token": proxyToken
    };
    await fetch(logUrl, { method: "POST", headers, body: payload.toString() });
  } catch (_err) {}
}

function plainResponse(code, body) {
  const resp = new Twilio.Response();
  resp.setStatusCode(code);
  resp.appendHeader("Content-Type", "text/plain");
  resp.setBody(body + " " + RB_BUILD_ID);
  return resp;
}

function shouldForwardKey(k) {
  const lower = String(k || "").toLowerCase();
  return !["token","route","practice_id","practiceid","x-twilio-signature"].includes(lower);
}

function shouldForwardKeyForFailure(k) {
  const lower = String(k || "").toLowerCase();
  if (lower === "body") return false;
  if (lower.indexOf("mediaurl") === 0 || lower.indexOf("mediacontenttype") === 0 || lower === "nummedia") return false;
  if (lower === "from" || lower === "to") return false;
  return shouldForwardKey(k);
}

function redactPhone(p) {
  if (!p) return "";
  var digits = String(p);
  return digits.length > 4 ? "..." + digits.slice(-4) : digits;
}

function isPrimitive_(v) {
  const t = typeof v;
  return v === null || t === "string" || t === "number" || t === "boolean";
}
