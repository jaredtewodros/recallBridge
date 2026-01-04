# Contributing — RecallBridge (pilot)

Thanks for helping maintain RecallBridge. This file captures the minimal developer and operator workflow for the pilot repository.

Quick principles
- Sheets remain the Source of Record (SoR) for the pilot — do not replace with a DB.
- Deploy Twilio Functions and Apps Script manually via their consoles (no CI/CD in this repo).
- Never commit real secrets. Use `.env.example` as a template and set secrets in the platform (Twilio Console / Apps Script Script Properties).
- Always prefer name-based header lookups when reading/writing Sheets (find-by-header), never rely on column indexes.

Local setup & testing
- Copy `.env.example` to `.env.local` (or set env vars in your shell). Important names:
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
  - `TWILIO_MESSAGING_SERVICE_SID` (used by `twilio_send_script.py`)
  - `APPS_SCRIPT_EXEC_URL` or `GS_ENDPOINT` (for Twilio Function testing)
  - `X_RB_KEY` (shared secret — optional during pilot)
- Run the send script in dry-run mode first:

```bash
export TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... \
  TWILIO_MESSAGING_SERVICE_SID=MG... 
python3 src/twilio_send_script.py path/to/list.csv --dry-run
```

Loading `.env` into your shell (safe options)

If you populate the repository-level `.env` file for local testing, here are a few safe ways to load it into your shell session (zsh):

- Quick temporary session (POSIX-compatible):

```bash
# export all KEY=VALUE pairs in .env for the current shell
set -a; source .env; set +a
```

- Alternative (creates a subshell environment for a single command):

```bash
env $(grep -v '^\s*#' .env | xargs) python3 src/scripts/gs_test_client.py --exec "$EXEC_URL"
```

Notes and safety:
- Do not commit your `.env` file. The repo includes a `.gitignore` entry for `.env`.
- Beware of values containing spaces or shell-sensitive characters; prefer `set -a; source .env` if values may include spaces or special characters.
- For long-term local development, consider using a secrets manager or tools like `direnv` instead of committing `.env` files.


Deploying Apps Script (manual)
1. Open the Apps Script editor for the project.
2. Paste or update `webhook.js` and `queue.js` (if applicable).
3. Set Script Properties (Project Settings) for `SHEET_ID`, `X_RB_KEY` (if using enforcement), then deploy: New deployment → Web app.
4. Set Execute as: Me, Who has access: Anyone. Copy the exec URL and use it for Twilio Function `GS_ENDPOINT`.

Deploying Twilio Functions (manual)
1. In the Twilio Console create/update Functions:
   - `/inbound-reply` — auto-reply + forward
   - `/status-callback` — delivery status forwarder
   - `/bds-link-click` — click redirect
2. In each Function's Configuration, add Environment Variables:
   - `GS_ENDPOINT` = Apps Script exec URL
   - `X_RB_KEY` = (optional) shared secret to forward
3. Save and deploy the Function from the Twilio Console.

Testing
- Use `src/scripts/gs_test_client.py --exec "$EXEC_URL"` to exercise inbound/delivery/click/consent flows.
- Use the known test number `+15712455560` only for testing, never commit it as a hardcoded value in production code.
- Run a quick secrets scan before deploying: `python3 src/scripts/check_secrets.py`. The script exits nonzero if it finds X_RB_KEY literals, Twilio-style tokens, or base64-looking blobs in source files.

## Validating Send Lists Before Use

Always validate your CSV before running a campaign:

```bash
python3 src/twilio_send_script.py ../send_lists/sample_test.csv --validate
```
- This checks all rows for required headers, blank/duplicate phones, and previews the first 10 rows.
- Keep PHI outside the repository (store CSVs in a sibling folder such as `../send_lists`). If validation fails, fix the issues or use `--force` to override (not recommended for production sends).

Code style & safety
- Keep changes minimal and focused. For Apps Script edits, maintain backward-compatible behavior where possible.
- Update `.codex/specs/*` when changing behavior (idempotency, consent rules, schema changes).

If in doubt, ask: do not flip `ENFORCE_KEY` to `true` until `X_RB_KEY` and `SHEET_ID` are configured in both Apps Script and Twilio Function configs.

Thank you — changes to this file should be coordinated with the operator who runs deployments.
