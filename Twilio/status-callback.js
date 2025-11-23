// Path: /status-callback
// Access Control: Protected
// Runtime: Node 18

exports.handler = async function (context, event, callback) {
  // Twilio sends fields like:
  // event.MessageSid, event.To, event.MessageStatus (queued|sent|delivered|failed|undelivered), event.ErrorCode
  const gsEndpoint = 'https://script.google.com/macros/s/AKfycby5KBwM6WlUbGg3AcBgMYcZh_yOTZK1agB2nTzlHai9sN11WdLj1FrRGIUV6peW0ZxMmA/exec';

  const payload = {
    event_type: 'delivery',
    to: event.To || '',
    message_sid: event.MessageSid || '',
    message_status: event.MessageStatus || '',
    delivered_at: new Date().toISOString(),
    error_code: event.ErrorCode || ''
  };

  try {
    const res = await fetch(gsEndpoint, {
      method: 'POST',
            headers: {'Content-Type': 'application/json', 'X-RB-Key': '1v<X$F[_ro&}.y%qJ3V^>d&z,5Ak^_'}, // must match EXPECTED_KEY
      body: JSON.stringify(payload)
    });
    const txt = await res.text();
    console.log('GS response:', txt);
  } catch (e) {
    console.error('Post to GS failed:', e);
  }

  return callback(null, { ok: true });
}