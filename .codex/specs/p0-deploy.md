# P0 — Deploy & Quick Tests

Purpose: Capture the minimal manual deploy steps required for Twilio Functions and Apps Script web app, plus quick validation commands.

Owner: Codex / repository maintainers

Status: completed (2025-11-23)

Summary:
- See `docs/DEPLOY.md` in the repository root for step-by-step instructions and curl examples.

Key points:
- Apps Script web app should be deployed as **Web app** (Execute as: Me; Who has access: Anyone) for the pilot.
- Twilio Functions are edited in the Twilio Console and deployed from there. Do not attempt to push via CI.
- Ensure `APPS_SCRIPT_EXEC_URL` is set in any local test harness or Twilio function config.

Advanced Sheets API note:
- The `createTodaysRepliesFilterView_` helper uses the Advanced Sheets API to create a saved Filter View and sort by `responded_at`. Ensure the GCP project for the Apps Script has the Sheets API enabled and that the Advanced Sheets service is enabled in the Apps Script project (Resources > Advanced Google services...). If the Advanced API is not enabled, the helper falls back to a non-destructive normal filter.

Status: preflight confirmations (2025-11-23)

- `SHEET_ID` set in Script Properties: confirmed.
- `X_RB_KEY` set in Script Properties and Twilio runtime: confirmed.
- Advanced Sheets API enabled in GCP and Advanced Sheets service enabled in Apps Script: confirmed.

Next steps:
- Optionally, create a Script Property or a small Config sheet to hold `SHEET_ID` for different environments.

Last updated: 2025-11-23
