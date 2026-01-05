// Path: /twilio-click
// Runtime: Node 18
// Purpose: Forward click webhook to GAS /exec via proxy header (retry on GAS 5xx only).
const RB_BUILD_ID = "2026-01-04T00:00:00Z";

exports.handler = async function (context, event, callback) {
  console.log("Click Proxy Hit", {
    practice_id: event.practice_id || "missing",
    type: event.EventType,
    sid: event.MessageSid || event.SmsSid,
    build: RB_BUILD_ID
  });
  const practiceId = event.practice_id || event.practiceId || "";
  const token = event.token || "";
  const proxyToken = context.RB_PROXY_TOKEN || "";
  const gasExec = context.GAS_EXEC_URL || "";
  const forwardUrl = gasExec ? `${gasExec}?route=twilio_click&practice_id=${encodeURIComponent(practiceId)}&token=${encodeURIComponent(token)}` : "";

  if (!forwardUrl || !proxyToken) {
    console.error("Misconfigured: Missing GAS_EXEC_URL or RB_PROXY_TOKEN");
    // Do not retry config errors.
    return callback(null, plainResponse(200, "misconfigured_no_retry"));
  }

  const payload = new URLSearchParams();
  Object.keys(event || {}).forEach(k => {
    if (!shouldForwardKey(k)) return;
    payload.append(k, event[k]);
  });

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-RB-Proxy-Token": proxyToken
  };

  try {
    const res = await fetch(forwardUrl, { method: "POST", headers, body: payload.toString() });
    const body = await res.text();
    console.log("GAS Response:", { status: res.status, len: body.length });
    var isGasErrorBody = body && (body.startsWith("<!DOCTYPE html>") || body.indexOf("<title>Error</title>") !== -1);
    // Retry only on 5xx or 200 with GAS error HTML.
    if (res.status >= 500 || (res.status === 200 && isGasErrorBody)) {
      console.error("GAS error - Triggering Retry", { status: res.status, isGasErrorBody: isGasErrorBody });
      return callback(null, plainResponse(500, "gas_server_error"));
    }
    if (res.status >= 400) {
      await logProxyFailure(context, event, res.status, body);
    }
    return callback(null, plainResponse(200, "ok"));
  } catch (err) {
    console.error("Forwarding failed", err);
    // Network failure: allow retry.
    return callback(null, plainResponse(500, "proxy_network_error"));
  }
};

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
    Object.keys(event || {}).forEach(k => {
      if (!shouldForwardKey(k)) return;
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
