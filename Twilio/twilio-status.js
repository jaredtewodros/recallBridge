// Path: /twilio-status
// Runtime: Node 18
// Purpose: Validate Twilio signature, then forward status webhook to GAS /exec via proxy header.

const twilio = require('twilio');

exports.handler = async function (context, event, callback) {
  try {
    const sig = context.request && context.request.headers ? (context.request.headers['x-twilio-signature'] || context.request.headers['X-Twilio-Signature'] || "") : "";
    const fullUrl = `https://${context.DOMAIN_NAME}${context.PATH}${context.request && context.request.query ? '?' + context.request.query : ''}`;
    console.log("status hit", { path: context.PATH, domain: context.DOMAIN_NAME, query: context.request && context.request.query, sig: sig, url: fullUrl });
  } catch (_e) {}
  const practiceId = event.practice_id || event.practiceId || "";
  const token = event.token || "";
  const proxyToken = context.RB_PROXY_TOKEN || "";
  const gasExec = context.GAS_EXEC_URL || "";
  const forwardUrl = gasExec ? `${gasExec}?route=twilio_status&practice_id=${encodeURIComponent(practiceId)}&token=${encodeURIComponent(token)}` : "";

  const sigHeader = (context.request && context.request.headers && (context.request.headers['x-twilio-signature'] || context.request.headers['X-Twilio-Signature'])) || "";
  const fullUrl = `https://${context.DOMAIN_NAME}${context.PATH}${context.request && context.request.query ? '?' + context.request.query : ''}`;
  const authToken = context.TWILIO_AUTH_TOKEN || context.AUTH_TOKEN || "";

  if (!authToken || !twilio.validateRequest(authToken, sigHeader, fullUrl, event)) {
    console.error("signature validation failed");
    return callback(null, plainResponse(403, "forbidden"));
  }

  if (!forwardUrl || !proxyToken) {
    console.error("missing forwardUrl or proxy token");
    return callback(null, plainResponse(500, "misconfigured"));
  }

  const payload = new URLSearchParams();
  Object.keys(event || {}).forEach(k => payload.append(k, event[k]));

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "X-RB-Proxy-Token": proxyToken
  };

  let attempt = 0;
  let success = false;
  while (attempt < 3 && !success) {
    try {
      const res = await fetch(forwardUrl, { method: "POST", headers, body: payload.toString() });
      const body = await res.text();
      console.log("forward status", { code: res.status, body });
      success = res.status >= 200 && res.status < 300;
      if (!success) await sleep(150 * (attempt + 1));
    } catch (err) {
      console.error("forward status error", err);
      await sleep(150 * (attempt + 1));
    }
    attempt++;
  }

  return callback(null, plainResponse(200, "ok"));
};

function plainResponse(code, body) {
  const resp = new twilio.Response();
  resp.setStatusCode(code);
  resp.appendHeader("Content-Type", "text/plain");
  resp.setBody(body);
  return resp;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
