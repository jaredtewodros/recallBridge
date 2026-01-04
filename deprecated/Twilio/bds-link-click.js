// Twilio Function: bds-link-click
// Path: /bds-link-click
// Runtime: Node 18

exports.handler = async function (context, event, callback) {
  // Prefer a GS endpoint set in the Twilio Function environment (context.GS_ENDPOINT).
  const gsEndpoint = context.GS_ENDPOINT || 'https://script.google.com/macros/s/AKfycby5KBwM6WlUbGg3AcBgMYcZh_yOTZK1agB2nTzlHai9sN11WdLj1FrRGIUV6peW0ZxMmA/exec';

  try {
    // Raw fields Twilio may send for Link Clicks
    // Common ones: EventType, MessageSid, ClickedUrl, ClickTime, AccountSid, MessagingServiceSid
    let to =
      event.to ||
      event.To ||
      event.phone ||
      event.Phone ||
      '';

    const eventType = event.EventType || event.Event || 'click';
    const clickedUrl = event.ClickedUrl || event.Url || '';
    const clickedAt = event.ClickTime || new Date().toISOString();
    const messageSid = event.MessageSid || '';

    // If phone isn't in payload, fetch the original message to get .to
    if (!to && messageSid) {
      const client = context.getTwilioClient();
      try {
        const msg = await client.messages(messageSid).fetch();
        to = msg.to || '';
        console.log(`Fetched msg.to from SID ${messageSid}: ${to}`);
      } catch (e) {
        console.error('Failed to fetch message by SID:', e);
      }
    }

    // Try to extract list_tag (lt=...) if you appended it to the original long URL
    let listTag = '';
    try {
      if (clickedUrl) {
        const u = new URL(clickedUrl);
        listTag = u.searchParams.get('lt') || '';
      }
    } catch (_) {
      // ignore malformed URL
    }

    const payload = {
      event_type: eventType,
      to: to || '',
      message_sid: messageSid,
      clicked_url: clickedUrl,
      clicked_at: clickedAt,
      list_tag: listTag,
    };

    console.log('Outgoing to GS:', JSON.stringify(payload));

    // Send to Google Apps Script (expects JSON)
    const headers = { 'Content-Type': 'application/json' };
    if (context.X_RB_KEY) headers['X-RB-Key'] = context.X_RB_KEY;

    const res = await fetch(gsEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log('GS response:', text);

    return callback(null, { ok: true });
  } catch (err) {
    console.error('bds-link-click error:', err);
    return callback(null, { ok: false, error: String(err) });
  }
}