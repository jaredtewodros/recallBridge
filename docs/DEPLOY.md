# Deploy & Test — RecallBridge (pilot)

This file documents minimal manual steps to deploy Twilio Functions and the Google Apps Script web app, plus quick test commands.

## Apps Script (Web App)
1. Open the Apps Script project bound to your `SHEET_ID`.
2. Paste `webhook.js` and any helpers into the project.
3. Deploy → **New deployment** → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the **exec URL** and set it in your Twilio Functions (and/or in `APPS_SCRIPT_EXEC_URL` env var for testing).

### Apps Script Script Properties (shared secret)

For optional request validation, set a Script Property named `X_RB_KEY` in the Apps Script project:

1. In the Apps Script editor, open **Project Settings** → **Script Properties**.
2. Add a property with key `X_RB_KEY` and the desired secret value.

Behavior:
- `ENFORCE_KEY=false` (pilot/default): the script will ignore the header check.
- `ENFORCE_KEY=true`: the script will require incoming requests to include an `X-RB-Key` header that exactly matches the `X_RB_KEY` Script Property.

Recommendation: use a fail-closed policy when `ENFORCE_KEY=true` — the Apps Script will deny requests if the Script Property is missing or the header does not match. This avoids accidental exposure when enforcement is turned on. During pilot you can keep `ENFORCE_KEY=false` while testing.

When enabling enforcement, also set `X_RB_KEY` as an Environment Variable in each Twilio Function (`X_RB_KEY`) so the Functions forward the header.

### Script Property: `SHEET_ID`

Set a `SHEET_ID` Script Property in the Apps Script project to point to the spreadsheet that should be used as the source of truth.

1. In the Apps Script editor, open **Project Settings** → **Script Properties**.
2. Add a property with key `SHEET_ID` and the spreadsheet ID (the long string from the sheet's URL).

Behavior & recommendation:
- If `SHEET_ID` is not configured, the script will currently use a legacy fallback spreadsheet ID (for convenience during local edits). However, to avoid accidental writes to production, configure `SHEET_ID` for each environment.
- If `ENFORCE_KEY=true` and `SHEET_ID` is missing, the Apps Script will deny requests (fail-closed) to prevent accidental processing.


## Twilio Functions
- Create three functions in the Twilio Console (Runtime Node 18):
  - `/inbound-reply` (auto-reply + forward inbound to Apps Script)
  - `/status-callback` (message status → Apps Script)
  - `/bds-link-click` (click redirect → Apps Script)
- In each function, set the `gsEndpoint` (or use the shared `APPS_SCRIPT_EXEC_URL`) before saving.
- If you later enable `ENFORCE_KEY=true` in Apps Script, set the header `X-RB-Key` (same value) when posting to the exec URL.

## Local send script
- `twilio_send_script.py` expects `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in the environment.
- Use `--dry-run` to preview messages; `--force` to override `sent_status=sent` in CSV.

## Quick tests (curl)
Replace `$EXEC` with your Apps Script exec URL.

Ping (GET):

```bash
curl -sSL "$EXEC?ping=1"
```

Inbound (JSON):

```bash
curl -sSL -H 'Content-Type: application/json' \
  --data '{"event_type":"inbound","from":"+15712455560","to":"+13016522378","body":"hello from JSON"}' \
  "$EXEC"
```

Delivery (form):

```bash
curl -sSL --data 'To=%2B15712455560&MessageStatus=delivered' "$EXEC"
```

Click (JSON):

```bash
curl -sSL -H 'Content-Type: application/json' \
  --data '{"event_type":"click","to":"+15712455560","clicked_at":"2025-11-22T23:00:00Z"}' \
  "$EXEC"
```

Consent:

```bash
curl -sSL --data 'From=%2B15712455560&Body=STOP'  "$EXEC"
curl -sSL --data 'From=%2B15712455560&Body=START' "$EXEC"
```

## Test harness (recommended)
- The repo includes `src/scripts/gs_test_client.py`. Run it with:

```bash
# set EXEC_URL or pass --exec
python3 src/scripts/gs_test_client.py --exec "$EXEC"
```

This will exercise ping, inbound, delivery, click, and consent flows (using the known test number `+15712455560` only for testing).

## Notes & safety
- Do NOT commit real secrets. Use `.env.example` as a template.
- Twilio Functions & Apps Script must be deployed manually — do not expect automated CI/CD here.
- Ensure your Sheets have the required headers defined by `docs/sheets.schema.json`.
