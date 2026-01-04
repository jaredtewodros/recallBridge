CSV Validation & Preview Usage (P1-8):
--------------------------------------
The `twilio_send_script.py` script validates **all rows** in the CSV for required headers, blank and duplicate `e164_phone` values, but only prints a preview of the first 10 rows.

To validate a send list before running a campaign:

```bash
python3 "Bethesda Dental Smiles/src/twilio_send_script.py" "Bethesda Dental Smiles/Send Lists/sample_test.csv" --validate
```

- This will print a summary of total, blank, duplicate, and unique phones, headers, and a preview of the first 10 rows.
- If there are validation errors, the script will exit with a nonzero code and print an error message.
- To override validation and proceed (for dry run or real send), add `--force`:

```bash
python3 "Bethesda Dental Smiles/src/twilio_send_script.py" "Bethesda Dental Smiles/Send Lists/sample_test.csv" --dry-run --force
```

**Note:** Validation always checks all rows, but only previews the first 10.
# P0 — Test Harness

Purpose: Provide a reproducible, minimal test harness for exercising Apps Script webhook flows (inbound, delivery, click, consent) against a dev `exec` URL.

Owner: Codex / repository maintainers

Status: completed (2025-11-23)

What was done:
- Added `src/scripts/gs_test_client.py` — a small Python stdlib-only script that POSTs sample payloads to an Apps Script exec URL or performs a ping (`GET ?ping=1`). Uses the known test number `+15712455560` only for testing.
- Added curl snippets in `docs/DEPLOY.md` that mirror the same test flows.

How to run:
- Set `EXEC_URL` env var or pass `--exec`:

```bash
python3 src/scripts/gs_test_client.py --exec "https://script.google.com/macros/s/REPLACE/exec"
```

Notes:
- The script posts JSON payloads; Apps Script supports both JSON and form-encoded payloads.
- Do not use production spreadsheets for automated testing — create a dev copy of the sheet and use its `SHEET_ID`.

Preflight/Smoke test checklist:
- Create a dev copy of the production spreadsheet and set its `SHEET_ID` in Script Properties (or use the `--exec` flag with a dev exec URL).
- Run `python3 src/scripts/gs_test_client.py --exec <EXEC_URL>` and execute the sequence: `ping`, `inbound`, `delivery`, `click`, `STOP`, `START`.
- After each run, verify the `Ping` sheet logged the event and that `Queue`/`Master` reflect expected changes (especially `sent_at`/`clicked_at` first-write semantics and `do_not_text` toggles).
- If `runCreateTodaysRepliesFilterView` is used, ensure the Advanced Sheets API is enabled and the named Filter View appears in the UI; otherwise accept the non-destructive fallback filter.

Status: smoke tests passed (2025-11-23)

Notes on verification performed:
- Confirmed `Ping` rows are created for each test event.
- Confirmed `Queue` is upserted on inbound tests and `status`/`notes` updated appropriately.
- Confirmed `Master.sent_at` and `Master.clicked_at` are set on delivery and click respectively and resist overwriting on duplicate events.
- Confirmed `STOP`/`START` toggle `do_not_text` and `Queue.status` appropriately.

Last updated: 2025-11-23
