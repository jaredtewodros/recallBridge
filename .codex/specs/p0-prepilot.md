```markdown
# P0 — Pre-Pilot Confirmation & Acceptance

Purpose: Capture the final pre-pilot confirmations, acceptance criteria, and remaining blockers (if any) so the team can confidently begin a small pilot.

Owner: ops / deployer and repository maintainers

Status: in-review (2025-11-23)

Confirmed (operator verified)
--------------------------------
- `SHEET_ID` set in Apps Script Script Properties — confirmed.
- `Config!B2` (kill-switch) present and set to `ON` — confirmed.
- `X_RB_KEY` present in Apps Script Script Properties and in Twilio Function runtime configuration — confirmed.
- Advanced Sheets API is enabled in GCP and the Apps Script Advanced Sheets service is enabled — confirmed.
- Smoke tests executed via `scripts/gs_test_client.py` (sequence: `ping`, `inbound`, `delivery`, `click`, `STOP`, `START`) against a dev copy of the spreadsheet — confirmed.

Acceptance criteria (for pilot start)
------------------------------------
- All of the above confirmations are true.
- `createTodaysRepliesFilterView_` succeeds creating the named Filter View `Today's Replies` via Advanced Sheets API (verified).
- `Master.sent_at` and `Master.clicked_at` demonstrate first-write-wins when duplicate events are posted (verified during smoke tests).
- `STOP` and `START` messages toggle `do_not_text` and `Queue.status` correctly (verified).
- A manual backup/copy of the production spreadsheet exists before any bulk sends.

Remaining high-priority items (recommended before expanding pilot)
----------------------------------------------------------------
- CSV preflight validation and preview (P1-8): implement basic checks in `twilio_send_script.py` to validate headers, detect missing/blank `e164_phone`, preview first N rows, and count unique recipients. Owner: dev. Priority: high.
- Secrets lint / pre-deploy scan (P1-9): add `scripts/check_secrets.py` or pre-commit hook to detect obvious literal secrets or placeholder misuse. Owner: dev/security. Priority: high.
- Monitoring & short-term logging (P1-10): keep `Ping` diagnostics enabled for 48–72h of pilot traffic and add a daily check for repeated errors. Owner: ops. Priority: high.
- (Optional) Diagnostic helpers: add a `listFilterViews_()` helper to enumerate Filter Views for quick verification in the Apps Script editor. Owner: dev. Priority: low.

Operational runbook (one-paragraph)
----------------------------------
Before enabling production sends, ensure `Config!B2` is `ON`, confirm `SHEET_ID` and `X_RB_KEY` in Script Properties, back up the production spreadsheet, enable Advanced Sheets API (if not already), and run the smoke tests with `scripts/gs_test_client.py` against a dev copy. During the first 48–72 hours of pilot, monitor the `Ping` sheet for `filter-view-error` and other exception tags and confirm no repeated failures appear.

Last updated: 2025-11-23
```
