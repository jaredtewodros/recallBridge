// Path: /twilio-status
// Runtime: Node 18
// Purpose: Forward status webhook to GAS /exec via proxy header (retry on GAS 5xx only).

exports.handler = async function (context, event, callback) {
  console.log("Status Proxy Hit", {
    practice_id: event.practice_id || "missing",
    sid: event.MessageSid || event.SmsSid,
    status: event.MessageStatus
  });
  const practiceId = event.practice_id || event.practiceId || "";
  const token = event.token || "";
  const proxyToken = context.RB_PROXY_TOKEN || "";
  const gasExec = context.GAS_EXEC_URL || "";
  const forwardUrl = gasExec ? `${gasExec}?route=twilio_status&practice_id=${encodeURIComponent(practiceId)}&token=${encodeURIComponent(token)}` : "";

  if (!forwardUrl || !proxyToken) {
    console.error("Misconfigured: Missing GAS_EXEC_URL or RB_PROXY_TOKEN");
    // Do not retry config errors.
    return callback(null, plainResponse(200, "misconfigured_no_retry"));
  }

  const payload = new URLSearchParams();
  Object.keys(event || {}).forEach(k => payload.append(k, event[k]));

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-RB-Proxy-Token": proxyToken
  };

  try {
    const res = await fetch(forwardUrl, { method: "POST", headers, body: payload.toString() });
    const body = await res.text();
    console.log("GAS Response:", { status: res.status, body });
    // Retry only when GAS is 5xx (e.g., lock contention) OR the body looks like the Apps Script error HTML.
    var isGasErrorBody = body && (body.startsWith("<!DOCTYPE html>") || body.indexOf("<title>Error</title>") !== -1);
    if (res.status >= 500 || isGasErrorBody) {
      console.error("GAS error - Triggering Retry", { status: res.status, isGasErrorBody: isGasErrorBody });
      return callback(null, plainResponse(500, "gas_server_error"));
    }
    return callback(null, plainResponse(200, "ok"));
  } catch (err) {
    console.error("Forwarding failed", err);
    // Network failure: allow retry.
    return callback(null, plainResponse(500, "proxy_network_error"));
  }
};

function plainResponse(code, body) {
  const resp = new Twilio.Response();
  resp.setStatusCode(code);
  resp.appendHeader("Content-Type", "text/plain");
  resp.setBody(body);
  return resp;
}
