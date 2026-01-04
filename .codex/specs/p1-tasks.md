# P1 — Important Tasks

Purpose: Track non-blocking but important items to improve reliability and developer ergonomics.

Owner: Codex / repository maintainers

Status: mixed (see items)

Tasks:

- P1-1: Replace hardcoded `SHEET_ID` with deploy-time config
- P1-1: Replace hardcoded `SHEET_ID` with deploy-time config
  - Status: completed (2025-11-23)
  - Changes made: `webhook.js` now reads `SHEET_ID` from Script Properties (`SHEET_ID`) with a legacy fallback; when `ENFORCE_KEY=true` and `SHEET_ID` is missing the script will deny requests (fail-closed).
  - Notes: Operator must set `SHEET_ID` in Apps Script Project Settings → Script Properties for each environment.

- P1-2: Expand repo docs / add `CONTRIBUTING.md`
  - Status: partially completed (root README present)
  - Next: add contributing guidelines and developer checklist for manual deployments.

- P1-3: Linter/check for `ENFORCE_KEY=false` while Twilio functions include `X-RB-Key` literal
  - Status: not-started
  - Suggestion: a small `scripts/check_secrets.py` which warns when patterns are present.

- P1-4: CSV validation and preview in `twilio_send_script.py`
  - Status: not-started
  - Suggestion: validate required headers (`e164_phone`, `list_tag`, `FName`, `LName`) and show a sample preview (first 10 rows) with counts.

- P1-5: Sheet-level kill-switch (`Config!B2`)
  - Status: completed (2025-11-23)
  - Changes made: `webhook.js` now checks `Config!B2` for the value `OFF` (case-insensitive). When `OFF`, webhook handlers return early and avoid writing to sheets. Operators can set/unset this cell to disable/enable webhook writes without redeploying.
  - Notes: Requires a `Config` sheet in the target spreadsheet with cell `B2` set to `OFF` to disable, or `ON` (or blank) to enable.

Additional P1 / Pre-Pilot Checklist (high-priority before pilot)
-----------------------------------------------------------

- P1-6: Verify Advanced Sheets API and Filter View helper
  - Status: completed (2025-11-23)
  - Details: Fixed the Advanced Sheets API payload in `createTodaysRepliesFilterView_` to use a supported `hiddenValues` payload for Filter Views; re-run `runCreateTodaysRepliesFilterView` in the Apps Script editor to create the named Filter View `Today's Replies`. Logger shows `Filter view created (advanced API)`.
  - Acceptance: The Queue sheet has a saved Filter View named "Today's Replies" which filters statuses to surface working statuses and sorts by `responded_at` descending.

- P1-7: Pre-pilot operational checklist (must-do)
  - Owner: ops / deployer
  - Items:
    - Set `SHEET_ID` in Apps Script Script Properties (or confirm `Config` uses correct sheet)
    - Ensure `X_RB_KEY` is set in Script Properties and Twilio Function runtime (if you intend to enable `ENFORCE_KEY` for pilot); coordinate secrets with security lead
    - Enable Advanced Sheets API in the project (GCP) and enable the Advanced Sheets service in the Apps Script project
    - Verify `runCreateTodaysRepliesFilterView` succeeds and UI shows the named Filter View (no sheet reorder)
    - Confirm `Config!B2` kill-switch exists and is set to `ON` for pilot
    - Run smoke tests: `ping`, `inbound`, `delivery`, `click`, `STOP`, `START` using `scripts/gs_test_client.py` against a dev copy of the spreadsheet
    - Verify `Master.sent_at` & `Master.clicked_at` first-write semantics (send duplicate events to verify)
    - Confirm conditional formatting on `Queue` works as expected for `dnd` and other statuses
    - Back up production SoR before any large sends (make a copy of the spreadsheet)
    - Confirm Twilio Function environment contains `GS_ENDPOINT` and `X_RB_KEY` placeholders (no literals committed)

- P1-8: CSV validation & preflight (send-safety)
  - Status: completed (2025-11-24)
  - Owner: dev
  - Implemented: `twilio_send_script.py` now supports `--validate` to check all rows for required headers, blank/duplicate phones, and preview the first 10 rows. Aborts on validation errors unless `--force` is used. Usage documented in README.md, CONTRIBUTING.md, and `.codex/specs/p0-test-harness.md`.

- P1-9: Secrets lint / pre-deploy scan
  - Status: completed (2025-11-24)
  - Owner: dev / security
  - Implemented: added `scripts/check_secrets.py` to scan the repo for Twilio-like tokens, X_RB_KEY literals, and long base64-ish blobs. Skips `.env` and large/binary files; masks matches in output. Exits nonzero if potential secrets are found.
  - Usage: `python3 "Bethesda Dental Smiles/scripts/check_secrets.py"` (optionally `--root <path>`). Run before copy/paste deploys.

- P1-10: Monitoring & logging
  - Status: completed (2025-11-25)
  - Owner: dev / ops
  - Implemented: added `src/Apps Script/ping_monitor.js` (time-triggerable monitor scanning Ping for error/fail tags within a 24h lookback). Deployed with a daily trigger; execution logs validated with test rows.
  - Next: optional email/Slack wiring or tuned lookback/patterns as needed.

- P1-11: Create dev copy of production spreadsheet and set its `SHEET_ID` in Script Properties
  - Status: completed (2025-11-24)
  - Owner: ops / deployer
  - Implemented: Dev sheet copy created (`BDS_Patient_Texts - Dev`, SHEET_ID set in the dev-bound Apps Script project). Twilio Functions temporarily pointed to the dev exec URL for smoke tests; prod remains untouched.

Pre-pilot confirmations (operator-verified)
------------------------------------------
- `SHEET_ID` present in Script Properties: completed.
- `Config!B2` kill-switch exists and set to `ON`: completed.
- `X_RB_KEY` present in Script Properties and Twilio runtime: completed.
- Advanced Sheets API and Advanced Sheets service enabled: completed.
- Smoke tests performed (ping, inbound, delivery, click, STOP, START) and passed: completed.

Last updated: 2025-11-23
