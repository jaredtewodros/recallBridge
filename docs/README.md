# RecallBridge – Twilio + Apps Script (pilot)

RecallBridge orchestrates recall outreach with **Twilio Functions** and a **Google Apps Script Web App** backed by Google Sheets. This repo mirrors the deployed code; Twilio and Apps Script must still be updated manually.

---

## Components
- **Twilio Functions (Node 18)** in `src/Twilio/`
  - Proxy set (signature validated, multi-practice aware): `twilio-status.js`, `twilio-click.js`, `twilio-inbound.js`
  - Legacy direct set (single endpoint JSON forwarders): `status-callback.js`, `bds-link-click.js`, `inbound-reply.js`
- **Apps Script (multi-practice)** in `src/Apps Script/RecallBridge Script/`
  - `WebApp.js` is the current webhook entrypoint (route + practice_id + token)
  - Supporting logic: `Schema.js`, `Utils.js`, `queue.js`, `Touches.js`, `Send.js`, `Templates.js`, etc.
- **Legacy Apps Script webhook**: `webhook.js` (single-sheet Master/Queue path with kill switch)
- **Sheets SoR**: tabs defined in `Schema.js` (`30_Patients`, `50_Queue`, `60_Touches`, `70_EventLog`, `10_Config`, etc.)

---

## Apps Script — WebApp.js (current webhook)
- **Deployment**: Deploy as Web App (Execute as Me, Anyone). doGet returns `ok`.
- **Required query params** on every POST: `route` (`twilio_status|twilio_click|twilio_inbound`), `practice_id`, `token`.
- **Script Properties**:
  - `RB_WEBHOOK_TOKEN` – shared secret matched against `token` query param.
  - `RB_PRACTICE_REGISTRY_JSON` – map of `{practice_id: spreadsheetId}`.
  - `RB_PROXY_TOKEN` (optional) – when present and sent as header `X-RB-Proxy-Token`, Twilio signature validation is skipped.
  - `RB_TWILIO_CREDS_JSON` (optional) – map `{practice_id:{authToken:"...",accountSid:"...",messagingServiceSid:"..."}}` used for Twilio signature validation (webhook) and live sending (Send.js).
  - `RB_PRACTICE_COPY_JSON` (optional) – practice-specific SMS copy/booking URL for Send.js rendering.
  - `TEST_TO_E164`, `RB_DEFAULT_TEST_PRACTICE_ID` – used by RunWebhookE2ETest helpers.
- **Routing/behavior**:
  - `twilio_status`: dedupes by SID/status, updates `60_Touches` (twilio_message_status, error_code, delivered/failed timestamps, send_state/status), prevents downgrading terminal states, logs to `70_EventLog`.
  - `twilio_click`: dedupes, increments `click_count` and sets `first_clicked_at`/`last_clicked_at` on `60_Touches`, logs to EventLog.
  - `twilio_inbound`: dedupes, normalizes phone, applies STOP/HELP semantics:
    - `STOP` ⇒ `30_Patients.do_not_text=true`, stamps stop_at in `60_Touches`, logs STOP.
    - Non-STOP/HELP replies stamp `reply_at` and `last_inbound_body` in `60_Touches`.
    - Updates `30_Patients.updated_at` for matching rows. Does **not** auto-upsert Queue.
  - **Validation**: if `RB_PROXY_TOKEN` header is missing/invalid, it attempts Twilio signature validation using `RB_TWILIO_CREDS_JSON` for the given `practice_id`.
  - **Deduping**: uses `70_EventLog.dedupe_key` (last ~500 rows) to drop repeats.
  - **Test helpers**: `SimulateTwilioStatusWebhook`, `SimulateTwilioClickWebhook`, `SimulateTwilioInboundWebhook`, `RunWebhookE2ETest`.

---

## Apps Script — supporting jobs (Sheets)
- **Schema**: headers/constants in `Schema.js` (`PATIENT_HEADERS`, `QUEUE_HEADERS`, `TOUCHES_HEADERS`, `EVENT_HEADERS`, `CONFIG_KEYS`).
- **RefreshPatients** (`Refresh.js`): normalizes phones into `phone_e164`, sets `has_sms_contact`, recomputes `recall_status`, normalizes boolean flags.
- **BuildQueue** (`queue.js`): reads `30_Patients`, filters by recall window/flags, writes `50_Queue` with eligibility reasons.
- **CreateTouchesFromQueue** (`Touches.js`): deterministic `touch_id` per patient/campaign/touch, populates `60_Touches`, preserves WOULD_SEND/SENT rows.
- **SendReadyTouches** (`Send.js`): **dry-run only** (live send throws). Claims READY touches, marks WOULD_SEND with timestamps (or SENT on live), uses Twilio creds per practice when live is enabled in future.
- **Templates** (`Templates.js`): renders link/manual SMS bodies with opt-out footer.
- **Preflight** (`Preflight.js`): asserts required sheets/headers/config and kill switch state.

---

## Legacy Apps Script — webhook.js
- Single-sheet path (Master/Queue) with optional secret gate (`ENFORCE_KEY=false` by default).
- Script Property `SHEET_ID` (or fallback ID) selects the spreadsheet; Config!B2 kill switch disables writes when set to `OFF/0/FALSE/NO`.
- Handles `event_type` (`inbound|delivery|click`) and consent (`STOP/START/UNSTOP/YES`) with 2h cache-based idempotency.
  - Inbound: upserts Queue by phone, appends notes, weak/strong status rules.
  - Delivery: stamps `sent_at/t1_sent_at/t2_sent_at` and `followup_stage=1` (first-write wins); failure/undelivered only logged.
  - Click: stamps `clicked_at` and `followup_stage=2` (first-write wins).
  - STOP/START: toggles `do_not_text` in Master + `status`/`do_not_text` in Queue (force overrides), appends notes.
- doGet logs Ping rows; doPost logs raw payloads to Ping for traceability.

---

## Twilio Functions
### Proxy functions (pair with WebApp.js)
- `twilio-status.js`, `twilio-click.js`, `twilio-inbound.js`
  - Validate Twilio signature with `TWILIO_AUTH_TOKEN` (required) and forward as `application/x-www-form-urlencoded` to `GAS_EXEC_URL?route=...&practice_id=...&token=...`.
  - Include header `X-RB-Proxy-Token: <RB_PROXY_TOKEN>` to bypass Apps Script signature checks.
  - Retries up to 3 times with small backoff; returns plain 200/forbidden/misconfigured responses.

### Legacy direct functions (single GS endpoint)
- `status-callback.js`: builds JSON `{event_type:'delivery', to, message_sid, message_status, delivered_at, error_code}` and POSTs to `GS_ENDPOINT` (optional `X_RB_KEY` header).
- `bds-link-click.js`: captures Twilio click payload, fetches `to` via MessageSid when missing, forwards JSON `{event_type:'click', to, clicked_url, clicked_at, list_tag?, message_sid}` to `GS_ENDPOINT`.
- `inbound-reply.js`: returns TwiML auto-reply, then POSTs JSON `{event_type:'inbound', from, to, body, message_sid}` to `GS_ENDPOINT` (optional `X_RB_KEY`).

---

## Deployment (WebApp.js path)
1) **Apps Script**
   - Deploy `WebApp.js` + helpers as Web App (Execute as Me, Anyone).
   - Set Script Properties: `RB_WEBHOOK_TOKEN`, `RB_PRACTICE_REGISTRY_JSON`, `RB_TWILIO_CREDS_JSON`, `RB_PROXY_TOKEN` (optional), `RB_PRACTICE_COPY_JSON`, `TEST_TO_E164`/`RB_DEFAULT_TEST_PRACTICE_ID` (for test helpers).
2) **Twilio**
   - For each practice/number/service, point webhooks to `<exec_url>?route=twilio_status|twilio_click|twilio_inbound&practice_id=<pid>&token=<RB_WEBHOOK_TOKEN>`.
   - Environment vars per function: `GAS_EXEC_URL` (Apps Script /exec), `RB_PROXY_TOKEN` (matches Script Property), `TWILIO_AUTH_TOKEN` (for signature validation). Add `practice_id`/`token` at the webhook URL level.

**Legacy path**: if you still use `webhook.js` + legacy Functions, set `SHEET_ID` (Script Property), keep `ENFORCE_KEY=false` unless you also set `X_RB_KEY` in both Apps Script and Twilio Functions.

---

## Quick Tests (WebApp.js)
```bash
EXEC='<exec url from Apps Script>'
PID='<practice_id key in RB_PRACTICE_REGISTRY_JSON>'
TOKEN='<RB_WEBHOOK_TOKEN>'
PROXY='<RB_PROXY_TOKEN>' # optional; omit header to exercise Twilio signature path

# Health (token required)
curl -sSL --data "route=health&practice_id=$PID&token=$TOKEN" "$EXEC"

# Status callback
curl -sSL \
  -H "X-RB-Proxy-Token: $PROXY" \
  --data "route=twilio_status&practice_id=$PID&token=$TOKEN&MessageSid=SM123&MessageStatus=delivered" \
  "$EXEC"

# Click event
curl -sSL \
  -H "X-RB-Proxy-Token: $PROXY" \
  --data "route=twilio_click&practice_id=$PID&token=$TOKEN&MessageSid=SM123&EventType=click&ClickTime=2025-01-01T00:00:00Z" \
  "$EXEC"

# Inbound (STOP)
curl -sSL \
  -H "X-RB-Proxy-Token: $PROXY" \
  --data "route=twilio_inbound&practice_id=$PID&token=$TOKEN&From=%2B15715550123&Body=STOP" \
  "$EXEC"
```
Expected: EventLog rows with dedupe_key, `60_Touches` updated for status/click/inbound, and `30_Patients.do_not_text` toggled on STOP.
