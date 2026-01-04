# Deploy Checklist — RecallBridge (short)

Use this checklist when performing a manual deployment or environment setup. Keep it short — follow the full steps in `docs/DEPLOY.md` when needed.

Before you start
- Ensure you have a dev copy of the Google Sheet (do not test on production).
- Have your Twilio account credentials and Console access ready.

Apps Script (Web App)
- [ ] Open Apps Script editor for the bound project.
- [ ] Paste/update `webhook.js` and `queue.js`.
- [ ] Set Script Properties:
  - `SHEET_ID` = ID of the dev/prod spreadsheet
  - `X_RB_KEY` = shared secret (only if you will enable `ENFORCE_KEY`)
- [ ] Deploy → New deployment → Web app (Execute as: Me; Who has access: Anyone)
- [ ] Copy the exec URL.

Twilio Functions
- [ ] Create/update Functions in Twilio Console: `/inbound-reply`, `/status-callback`, `/bds-link-click`.
- [ ] In each Function Configuration set Environment Variables:
  - `GS_ENDPOINT` = Apps Script exec URL
  - `X_RB_KEY` = same secret as Script Property (if using enforcement)
- [ ] Save & deploy each Function.

Validation / Smoke tests
- [ ] Run `scripts/gs_test_client.py --exec "$EXEC_URL"` to exercise ping/inbound/delivery/click/STOP/START.
- [ ] Check the `Ping` sheet (or Apps Script logs) for incoming events.
- [ ] If using the send script, run it in `--dry-run` mode and confirm generated bodies and tracking links.

Enable enforcement (only after verification)
- [ ] Set `ENFORCE_KEY = true` in Apps Script `webhook.js` (or manage via a higher-level config).
- [ ] Confirm `X_RB_KEY` Script Property and Twilio `X_RB_KEY` env var are set and match.
- [ ] Re-run smoke tests.

Rollback notes
- If something breaks, disable `ENFORCE_KEY` in Apps Script or revert Function changes in Twilio Console; restore the previous Apps Script deployment.
