# P0 — Secrets & Env Handling

Purpose: Ensure secrets are not committed, provide clear env var names for local/dev use, and document where secrets belong in deployment.

Owner: Codex / repository maintainers

Status: completed (2025-11-23)

What was done:
- Added `/.env.example` at repository root listing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `APPS_SCRIPT_EXEC_URL`, and `X_RB_KEY` placeholders.

Notes / rationale:
- Twilio Functions and Apps Script are deployed manually; secrets used at runtime must be set in Twilio Console or Apps Script Script Properties as appropriate.
- Current Twilio function examples include a literal `X-RB-Key` header value. That value should not be treated as a committed secret — replace with a placeholder before deploying, and set the real value in the Twilio Function configuration or use `context` variables.

Next steps:
- Replaced literal `X-RB-Key` strings in `src/Twilio/*.js` with `context` placeholders so Twilio Functions read `context.X_RB_KEY` at runtime (2025-11-23).
- Documented `GS_ENDPOINT` and `X_RB_KEY` usage in `.env.example`. Operators should set `GS_ENDPOINT` and `X_RB_KEY` as Twilio Function environment variables (Runtime Configuration) and as local env vars for testing.

Status: completed (2025-11-23)

Last updated: 2025-11-23
