You are Codex acting as a senior engineer. You are working inside an existing Google Apps Script (standalone) codebase for RecallBridge. The system already has:

- A versioned template generator CreateVersionedTemplateV1()
- A practice provisioning function ProvisionPracticeEngineFromLatestTemplate()
- A per-practice “engine” spreadsheet with tabs including (names may vary): Config, Patients, Queue, Touches (e.g., 60_Touches), EventLog, RunLog, Stats
- A preflight that enforces header-based schema (header names are the API; no column-order dependencies)
- A dry-run orchestrator and invariant checks
- SendReadyTouches() already exists and can send outbound SMS through Twilio
- Link shortening is already working with Twilio Messaging Services (Twilio-branded shortened links) and click tracking is “confirmed” as a capability, but not yet wired into our sheet.

Your job: implement “Send v1 execution block” that wires Twilio callbacks (status + clicks + inbound) into the practice engine spreadsheet in an auditable, idempotent way. January sending MUST NOT depend on the DB. This is only Apps Script + Google Sheets + Twilio.

Non-negotiables:
1) Idempotent and auditable. No silent double-sends.
2) Header names are the API; do not rely on column order anywhere.
3) Only append new columns; never rename/reorder/delete existing columns.
4) Webhook handlers must be safe to receive duplicates (Twilio retries).
5) The system must scale to multiple practices without cloning code. One codebase; many practice sheets.

We need 3 webhook streams:
A) Outbound Message Status callbacks (delivered/undelivered/failed/etc.)
B) Link Shortening click events (event_type = click|preview)
C) Inbound messages (STOP, HELP, general replies)

Key Twilio payload facts (use these as canonical):
- Click event callback example JSON from Twilio includes: event_type, sms_sid, to, from, link, click_time, messaging_service_sid, account_sid, user_agent. event_type is click or preview. sms_sid is the Message SID. click_time is ISO timestamp.
- Status callback requests vary, but include MessageStatus and ErrorCode, plus a subset of Twilio standard request properties. Twilio may add new parameters without notice. We must not hardcode an allowlist; our code must tolerate unknown fields.
- For inbound message webhooks, Twilio sends x-www-form-urlencoded fields like From, To, Body, MessageSid/SmsSid, AccountSid, etc.

SECURITY (minimum viable, do it now):
- Require a shared secret token in the webhook URL query string: ?token=... (store in Script Properties).
- Also include practice_id in the webhook URL query string (NOT PHI).
- OPTIONAL (only if straightforward in the timebox): add Twilio signature validation. BUT do not block shipping on it. The shared secret token is required.

ROUTING:
We have multiple practice engine spreadsheets. A single Apps Script Web App endpoint must route an incoming webhook event to the correct practice sheet.
- Routing key: practice_id in query string (e.g., dkc). NOT by phone number.
- Store a registry mapping practice_id -> spreadsheet_id in Script Properties as JSON (if it exists already, reuse it; if not, add it).
  Example Script Property: RB_PRACTICE_REGISTRY_JSON = {"dkc":"<spreadsheetId>", "bethesda_dental_smiles":"<spreadsheetId>"}.
- When provisioning a practice engine, ensure that registry is updated automatically (if you already have this, keep it; if not, implement it).
- If practice_id missing or unknown: hard-fail (HTTP 400/404) and log a minimal error (no PHI).

DEPLOYMENT:
- Implement doPost(e) as the single webhook entrypoint in Apps Script Web App.
- It must accept both application/x-www-form-urlencoded and application/json.
- It must return fast with 200 OK (and small body like “ok”) after processing.
- Log every webhook receipt into EventLog (append-only) with a dedupe key to prevent double-processing.

## Problem 4 — Programmatic Web App Exec URL Discovery
- ScriptApp.getService().getUrl() is not the source of truth; stop relying on manual RB_WEBHOOK_BASE_URL. Use Apps Script API deployments.list to fetch the active Web App exec URL (same as Manage Deployments).
- One-time setup: OAuth consent screen configured; Apps Script linked to a standard GCP project; Apps Script API enabled. If you can edit the manifest, add scopes `.../script.deployments.readonly` and `.../script.external_request`. If you cannot edit appsscript.json in your editor, enable the **Apps Script API** advanced service (“Script”) instead; it will inject the required scope automatically when you call `Script.Deployments.list`. If the advanced service toggle is not visible in the IDE, the code will fall back to ScriptApp.getService().getUrl() (normalized to /exec); re-run after enabling the service to upgrade to API-based discovery.
- Selection logic: entryPoints with entryPointType=WEB_APP and webApp.url present; prefer access ANYONE_ANONYMOUS, else ANYONE; then newest updateTime; tie-breaker: description contains “prod”/“production”; else deploymentId.
- Cache: CacheService (script) stores the exec URL for ~6h. getCurrentWebAppExecUrl_() populates cache; invalidateWebAppExecUrlCache_() clears it; rbDebug_LogExecUrl() logs deploymentId/updateTime/access/url and refreshes cache. Webhook hot paths should only read cached/service URLs (no API call).
- Troubleshooting: 401/403 ⇒ enable Apps Script API and authorize scopes; empty deployments ⇒ ensure a Web App deployment exists; wrong access ⇒ set Execute as Me + Who has access Anyone/Anyone anonymous; stale exec after redeploy ⇒ call invalidateWebAppExecUrlCache_() or rbDebug_LogExecUrl(); wrong URL from ScriptApp.getService().getUrl() ⇒ ignore and use API-discovered exec.

## Problem 5 — Twilio Webhook Proxy (Functions) to avoid Apps Script 302→405
- Symptom: Twilio 11200 Debugger errors with 405 Allow: GET,HEAD when posting directly to GAS /exec (Apps Script 302→405 redirect behavior).
- Architecture: Twilio (Status/Clicks/Inbound) → Twilio Function proxy → GAS /exec. Proxy validates Twilio signature, then forwards form-encoded payload with header X-RB-Proxy-Token to GAS; GAS trusts the proxy token and skips Twilio signature when present. Proxy returns 200 “ok” immediately and retries forward briefly on failure.
- Config: ScriptProperty `RB_TWILIO_PROXY_BASE_URL` holds the Twilio Function base; ScriptProperty `RB_PROXY_TOKEN` is shared between proxy and GAS. `SyncWebhookUrlsAll` writes status/click/inbound URLs using the proxy base (and also refreshes the template). GAS still discovers its exec URL for forwarding target.
- Setup per practice: In Twilio Messaging Service/phone number, set Status Callback to `${proxyBase}/twilio-status?practice_id=<pid>&token=<RB_WEBHOOK_TOKEN>`; Clicks webhook to `${proxyBase}/twilio-click?...`; Inbound (if used) to `${proxyBase}/twilio-inbound?...`.
- Testing: send 1 SMS → verify status delivered in EventLog and no 11200; click link → verify click logged and no 11200; inbound STOP/HELP if wired.
- Troubleshooting: 403 from proxy → check Twilio signature/auth token in Function; 403 from GAS → check X-RB-Proxy-Token vs RB_PROXY_TOKEN; 11200 persists → ensure Twilio webhooks point to proxy base, not GAS; stale exec URL → refresh GAS exec cache and update Twilio Function `GAS_EXEC_URL` env if changed.

## Web App Public Access + Endpoint Testing
- Admin console prerequisite: in Workspace Admin → Drive and Docs → Sharing settings, ensure “users can make files and published web content visible to anyone with a link” is ON; otherwise the Web App deployment dialog will not show “Anyone”.
- Deployment settings: Deploy → Web App with Execute as: Me, Who has access: Anyone; use the resulting `/exec` URL.
- Healthcheck behavior: `doGet` returns text `ok`; `doPost` with `route=health&token=<RB_WEBHOOK_TOKEN>` returns `ok` and skips Twilio signature + sheet access (token required).
- Curl POST (avoid `-X POST` + `-L` redirect trap):
```bash
curl -i -L \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "route=health&token=RB_WEBHOOK_TOKEN_VALUE" \
  "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"
```
- Optional GET health: `curl -i -L "https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec"` (expect `ok`).
- Success = Incognito GET shows `ok`; curl health POST returns `ok`; no Google login or 401/302-to-login.
- Failure modes: `Script function not found: doGet` means runtime reached but doGet missing; `302` then `405 Allow: GET, HEAD` means curl forced POST through redirect (`-X POST` with `-L`); Google login/401 means deployment not public or execute-as wrong.

## Current status / open issue (2025-12-27)
- Core send/callback plumbing is in place, but callbacks are not hitting because the computed service URL (`ScriptApp.getService().getUrl()`) still returns an older deployment (`AKfycbzq0.../exec`) while the active Web App in Manage deployments is `AKfycbyP8j.../exec`.
- Helpers added:
  - `DebugInspectExecUrls()` shows service_url vs normalized_exec_url vs cached/discovered exec.
  - `rbDebug_LogExecUrl()` fetches deployments.list, logs deploymentId/updateTime/access/url, and refreshes the exec cache.
  - `DebugSetWebhookBaseFromService()` now refreshes the exec cache from deployments.list (legacy name).
  - `SyncWebhookUrlsForPractice` / `SyncWebhookUrlsAll` rebuild callback URLs in 10_Config from the discovered base + token + practice_id.
- Next unblock steps:
  1) Edit the existing Web App deployment to latest code (same deployment slot).
  2) Run `rbDebug_LogExecUrl()` (or `DebugInspectExecUrls()`) to confirm the discovered exec matches Manage Deployments.
  3) Run `SyncWebhookUrlsForPractice('bethesda_dental_smiles')` (or `SyncWebhookUrlsAll`) to push refreshed callback URLs into 10_Config using the discovered exec.
  4) Re-test callbacks once URLs and deployment are aligned.

DATA MODEL UPDATES (Sheets):
1) 60_Touches (or Touches tab):
   - Ensure these columns exist (append if missing; do not rename existing):
     - twilio_message_sid (string)  [if you already store msg SID, reuse existing header name]
     - send_state (READY|SENDING|SENT|ERROR|SKIPPED)  [if exists, reuse]
     - send_attempt_id (uuid-ish string)  [new]
     - sent_at (timestamp)  [likely exists]
     - twilio_message_status (string)  [new]
     - twilio_error_code (string/int)  [new]
     - delivered_at (timestamp)  [new]
     - undelivered_at (timestamp)  [new]
     - failed_at (timestamp)  [new]
     - click_count (number)  [new]
     - preview_count (number)  [new]
     - first_clicked_at (timestamp)  [new]
     - last_clicked_at (timestamp)  [new]
     - stop_at (timestamp)  [if exists, reuse; otherwise add]
     - reply_at (timestamp) [if exists, reuse; otherwise add]
     - last_inbound_body (string) [new; store truncated to e.g. 160 chars]
   - Touches are keyed by a stable touch_id or composite keys already in your sheet (campaign_id + patient_key + touch_name). Do not invent a new fragile key if one exists. The webhook update should primarily match by twilio_message_sid, since click + status callbacks include sms_sid / MessageSid.

2) Patients tab:
   - Must already have do_not_text flag.
   - Add/ensure a column: do_not_text_source (e.g., "STOP", "manual", "unknown") [optional]
   - Add/ensure: do_not_text_at timestamp [optional]
   - Inbound STOP must set do_not_text=TRUE idempotently.

3) EventLog tab:
   - Append-only rows for every webhook and important state transition.
   - Ensure these headers exist (append if missing):
     - event_id (uuid-ish)
     - event_type (twilio.status_callback | twilio.click_event | twilio.inbound_message | send.attempt | send.result)
     - practice_id
     - received_at
     - dedupe_key
     - touch_id (nullable)
     - twilio_message_sid (nullable)
     - payload_json (string; store JSON.stringify(payload); may truncate if needed but keep enough)
     - notes / error (nullable)
   - DEDUPE: before processing a webhook, compute a dedupe_key and check recent EventLog rows for that dedupe_key. If already seen, return 200 OK without changing anything.
     - For status callback (x-www-form-urlencoded): dedupe_key = "status:" + MessageSid + ":" + MessageStatus + ":" + (ErrorCode||"")
     - For click event (json): dedupe_key = "click:" + sms_sid + ":" + event_type + ":" + click_time
     - For inbound message: dedupe_key = "inbound:" + (MessageSid||SmsSid||"") + ":" + (From||"") + ":" + (Body||"")
       (Also treat STOP as idempotent even if dedupe fails.)

SEND PATH HARDENING (critical):
We must eliminate the “I ran SendReadyTouches twice and double-sent” risk.

Modify SendReadyTouches() to be strictly two-phase:
Phase 1: claim rows
- For each touch row with send_state=READY and all send preconditions pass:
  - Atomically set send_state=SENDING
  - Set send_attempt_id to a new UUID
  - Set sending_claimed_at timestamp
  - (Use LockService to protect the claim step.)
- After claiming, re-read the claimed rows to build the send batch.

Phase 2: send
- For each claimed row:
  - Call Twilio Messages API to send.
  - Include StatusCallback URL per message that points to our Web App:
      <WEB_APP_EXEC_URL>?route=twilio_status&practice_id=<practice_id>&token=<RB_WEBHOOK_TOKEN>
    IMPORTANT: Do NOT put PHI in query string.
  - Ensure your existing link-shortening behavior stays enabled (whatever param you’re using today; do not break it).
  - On success:
      - write twilio_message_sid
      - set send_state=SENT
      - set sent_at timestamp
      - log EventLog send.result with payload (response)
  - On failure:
      - set send_state=ERROR
      - set error fields
      - log EventLog send.result with error details
- Idempotency requirement:
  - If a row is already SENDING or SENT and has a twilio_message_sid, do not send again.
  - If a row is SENDING but older than a timeout (e.g., 30 min) and has no SID, mark ERROR with reason “stuck_sending_timeout” and require manual operator action (don’t auto-resend).

WEBHOOK HANDLERS:
Implement doPost(e) router:
- Read query params: route, practice_id, token
- Validate token == ScriptProperty RB_WEBHOOK_TOKEN else return 403
- Load practice sheet by looking up practice_id in registry JSON (Script Properties)
- Parse payload:
   - If Content-Type includes application/json: JSON.parse(e.postData.contents)
   - Else parse e.parameter (x-www-form-urlencoded)
- Switch(route):
   1) twilio_click
   2) twilio_status
   3) twilio_inbound
- For unknown route: 400

Handler: twilio_click
- Payload is JSON per Twilio click callback.
- Extract: sms_sid, event_type, click_time, to, from, link, user_agent, account_sid, messaging_service_sid
- Dedupe using click dedupe_key.
- Find touch row by twilio_message_sid == sms_sid (header map; no column order)
- If found:
  - If event_type == "click":
      - click_count += 1
      - set first_clicked_at if empty
      - set last_clicked_at to click_time
  - If event_type == "preview":
      - preview_count += 1
      - (Do NOT set clicked_at / do not count as CTR click)
- Always log EventLog with payload_json and touch_id if resolved.

Handler: twilio_status
- Payload is x-www-form-urlencoded (but tolerate additional params)
- Extract: MessageSid (or SmsSid), MessageStatus, ErrorCode, maybe RawDlrDoneDate if present
- Dedupe using status dedupe_key.
- Find touch row by twilio_message_sid == MessageSid
- Update touch row fields:
   - twilio_message_status = MessageStatus
   - twilio_error_code = ErrorCode (if present)
   - If MessageStatus == delivered: set delivered_at if empty
   - If MessageStatus == undelivered: set undelivered_at if empty
   - If MessageStatus == failed: set failed_at if empty
- IMPORTANT: status callbacks can arrive out of order. Do NOT “downgrade” terminal states:
   - Terminal states: delivered, undelivered, failed
   - If already terminal, ignore non-terminal updates.
- Log EventLog with payload_json and touch_id.

Handler: twilio_inbound
- Payload is x-www-form-urlencoded.
- Extract: From, To, Body, MessageSid/SmsSid, AccountSid
- Normalize Body (trim, uppercase for STOP/HELP checks)
- Dedupe inbound
- Behavior:
   - If Body is exactly STOP (or matches common STOP keywords: STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT):
       - Find patient in Patients by phone_e164 matching From (normalize to E.164 same as your existing normalization)
       - Set patient.do_not_text = TRUE idempotently
       - Set do_not_text_source="STOP", do_not_text_at=now
       - Also update any “open” touches for that patient in this campaign: set stop_at if empty (optional but useful)
       - Log EventLog
       - Return 200
   - Else if Body is HELP:
       - We are NOT auto-replying yet in this block. Just log it.
   - Else:
       - Treat as a reply signal:
           - Find patient by phone_e164 == From
           - Optionally find most recent touch row to that phone (by sent_at desc) and set reply_at if empty and last_inbound_body
           - Log EventLog
- Do not send any TwiML responses in this block (keep scope tight). Just ingest and mark.

CONFIG / TEMPLATE UPDATES:
- Update CreateVersionedTemplateV1() so newly created templates include any new columns above (Touches + EventLog + Patients).
- Update provisioning so each practice engine gets:
   - practice_id in Config
   - webhook URLs printed in Config for convenience:
       WEBHOOK_BASE_EXEC_URL (the /exec URL)
       STATUS_CALLBACK_URL
       CLICK_CALLBACK_URL
       INBOUND_WEBHOOK_URL
   - Registry updated with practice_id -> sheetId

Twilio Console wiring checklist (document in README + optionally provide helper function that prints the URLs):
- For each practice’s Messaging Service:
   - Set Link Shortening “Clicks” callback URL to: <WEB_APP_EXEC_URL>?route=twilio_click&practice_id=<practice_id>&token=<token>
- For outbound status callbacks:
   - We set StatusCallback per-message in the API request (preferred), so Twilio hits: route=twilio_status...
- For inbound:
   - Configure the practice’s phone number “A message comes in” webhook URL to: route=twilio_inbound...
   - (If inbound is set at Messaging Service instead, document where to set it; but pick one and be consistent.)

TESTS / ACCEPTANCE CRITERIA (must implement as executable test helpers + a manual runbook):
Create a new function: RunWebhookE2ETest(practice_id)
- It should:
  1) Create a single “test touch” row to a specified test phone (use a Script Property TEST_TO_E164) with a body containing a known URL (so link shortening triggers).
  2) Call SendReadyTouches() with DRY_RUN=false and limit=1 (or similar).
  3) Assert the touch row transitions READY -> SENDING -> SENT and has twilio_message_sid populated.
  4) Provide instructions for the operator to:
     - Wait for delivery callback; then verify in sheet that twilio_message_status updated and delivered_at set.
     - Click the link; verify click_count increments and first_clicked_at set; preview events do not set click fields.
     - Reply STOP from the phone; verify patient.do_not_text flips true and future Queue excludes them.
- Also implement “fake webhook injection” helpers to test without Twilio:
   - SimulateTwilioClickWebhook(practice_id, sms_sid, event_type, click_time)
   - SimulateTwilioStatusWebhook(practice_id, message_sid, message_status, error_code)
   - SimulateTwilioInboundWebhook(practice_id, from, body)
  These should call internal handler functions directly (NOT doPost) to avoid needing HTTP during tests.

Timebox discipline:
- Do not build any database pieces.
- Do not build a UI.
- Do not add “queue v2”.
- Do not implement automated reply messages.
- Only ship: callback ingestion + send idempotency hardening + template/provision updates + tests/runbook.

Deliverables at end of this block:
1) Web App doPost router with 3 routes working.
2) Touch row updates for status/click/stop/reply working and idempotent.
3) EventLog entries for every webhook + dedupe keys.
4) Two-phase SendReadyTouches that prevents double-sends.

-------------------------------------------------------------------------------
Progress checkpoint (implemented vs remaining)

Completed:
- Web App router with routes twilio_status/twilio_click/twilio_inbound; shared-token gate; optional Twilio signature validation (best effort).
- Schema expanded (Touches/Patients/EventLog) with new columns; Preflight enforces; template creation writes them; headers protected.
- Provisioning updates registry (practice_id -> sheetId) and writes webhook URLs into Config (status/click/inbound/base).
- Webhook handlers update Touches (delivery/click/stop/reply) and Patients (do_not_text_source/at) idempotently with dedupe_key logging to EventLog.
- SendReadyTouches hardened to two-phase claim/send with lock, send_attempt_id, stuck-sending timeout; DRY_RUN marks WOULD_SEND (no Twilio call yet).
- Helper RunWebhookE2ETest (manual click/STOP flow) and simulation helpers for status/click/inbound.

Remaining:
- Twilio Messages API call now wired in SendReadyTouches for LIVE: reads creds from Script Property RB_TWILIO_CREDS_JSON (map practice_id -> {accountSid,authToken,messagingServiceSid}), sends via UrlFetch, sets msg_sid/send_state/sent_at, logs success/fail. DRY_RUN path retained. Throws if creds missing.
- RunWebhookE2ETest supports DRY_RUN or LIVE (live flag); live mode polls for msg_sid and SENT, otherwise fails; still requires human click/STOP for callbacks.

Notes:
- Routing to practice sheets is driven by practice_id in webhook URL + RB_PRACTICE_REGISTRY_JSON; subaccount selection happens in Twilio by the credentials/Messaging Service used when sending.
5) Updated template generator + provisioning.
6) A short README/runbook: how to deploy web app + where to paste Twilio webhook URLs + how to run RunWebhookE2ETest.

When you output code:
- Keep functions small.
- Use header->index maps everywhere.
- Hard-fail loudly with clear errors (do not silently skip).
- Never rely on column order.
- Never mutate existing columns; only append new ones.
- Include comments that explicitly call out idempotency decisions and terminal-state logic for status updates.
- Message rendering: ported templates.py into Templates.js (link/manual modes, opt-out footer). SendReadyTouches now uses renderMessage in manual mode (no link) and can pick up office_phone from Config if present.
