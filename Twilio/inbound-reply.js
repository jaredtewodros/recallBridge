// /inbound-reply  (Twilio Functions, Node 16/18)
exports.handler = async function(context, event, callback) {
  // Quiet hours check could live here if you want
  const replyText = 'Thanks for your message. A team member will reply shortly. For urgent needs call 301-656-7872.';

  // Send auto-reply SMS
  const twiml = new Twilio.twiml.MessagingResponse();
  twiml.message(replyText);

  // Forward to Google Apps Script as JSON
  try {
    // Use `context.GS_ENDPOINT` when set in Twilio Function config; fall back to a best-guess placeholder.
    const gsEndpoint = context.GS_ENDPOINT || 'https://script.google.com/macros/s/AKfycby5KBwM6WlUbGg3AcBgMYcZh_yOTZK1agB2nTzlHai9sN11WdLj1FrRGIUV6peW0ZxMmA/exec';
    const payload = {
      event_type: 'inbound',
      from: event.From || '',
      to: event.To || '',
      body: event.Body || '',
      message_sid: event.MessageSid || '',
    };
    const headers = { 'Content-Type': 'application/json' };
    // add shared-secret header only when configured in the Twilio Function environment
    if (context.X_RB_KEY) headers['X-RB-Key'] = context.X_RB_KEY;

    const res = await fetch(gsEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const txt = await res.text();
    console.log('GS response:', txt);
  } catch (e) {
    console.error('GS post failed:', e);
  }

  return callback(null, twiml);
};
