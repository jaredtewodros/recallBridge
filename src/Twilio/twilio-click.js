// Path: /twilio-click
// Runtime: Node 18
// Purpose: Forward click webhook to GAS /exec via proxy header (no proxy-side signature validation).

exports.handler = async function (context, event, callback) {
  console.log("Click Proxy Hit", {
    practice_id: event.practice_id || "missing",
    type: event.EventType,
    sid: event.MessageSid || event.SmsSid
  });
  const practiceId = event.practice_id || event.practiceId || "";
  const token = event.token || "";
  const proxyToken = context.RB_PROXY_TOKEN || "";
  const gasExec = context.GAS_EXEC_URL || "";
  const forwardUrl = gasExec ? `${gasExec}?route=twilio_click&practice_id=${encodeURIComponent(practiceId)}&token=${encodeURIComponent(token)}` : "";

  if (!forwardUrl || !proxyToken) {
    console.error("Misconfigured: Missing GAS_EXEC_URL or RB_PROXY_TOKEN");
    return callback(null, plainResponse(500, "misconfigured"));
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
    return callback(null, plainResponse(200, "ok"));
  } catch (err) {
    console.error("Forwarding failed", err);
    return callback(null, plainResponse(200, "error_logged"));
  }
};

function plainResponse(code, body) {
  const resp = new Twilio.Response();
  resp.setStatusCode(code);
  resp.appendHeader("Content-Type", "text/plain");
  resp.setBody(body);
  return resp;
}
