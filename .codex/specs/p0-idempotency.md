# P0 — Idempotency & Consent Correctness

Purpose: Guarantee first-write-wins semantics for `sent_at` and `clicked_at` in `Master`, and ensure `Queue` status/notes handling for inbound/consent flows. This prevents data races and gives staff predictable state.

Owner: Codex / repository maintainers

Status: completed (2025-11-23)

What was done:
- Hardened `updateMasterByTo_` in `src/Apps Script/webhook.js` to only set `sent_at` and `clicked_at` when the existing values are empty, unless explicit `forceSent` / `forceClicked` flags are provided by the caller.
- Retained `CacheService`-based dedupe (TTL 7200s) to guard against duplicate webhook posts.
- Apps Script `upsertQueue_` continues to respect strong vs weak statuses and supports `forceStatus` for consent flows.

Notes / rationale:
- First-write wins is the simplest, safest policy for a Sheets-backed SoR.
- `force*` flags are used sparingly (consent recovery flows only).

Next steps (if needed):
- Add integration tests that post duplicate delivery/click payloads to confirm idempotency in a dev sheet.
- Monitor CacheService usage and add logs/alerts if dedupe starts failing.

Last updated: 2025-11-23

Lock status policy (decision)
--------------------------------
- Decision: **Policy A (KEEP)** — plain inbound messages will set weak statuses to `new` (i.e. they may overwrite `new`, `texted`, but will NOT overwrite the defined *strong* statuses such as `booked`, `closed`, `dnd`, `wrong_number`). This mirrors the current `upsertQueue_` behavior where `strong = new Set(['booked','closed','dnd','wrong_number'])` and inbound calls use `status: 'new'` unless `forceStatus` is set.
- Rationale: For pilot operations we want inbound replies to re-open or re-prioritize weak leads so agents see fresh replies immediately. Agents should be careful when changing strong statuses.

Operator-facing SOP (one-liner):
- Inbound messages: "A plain inbound reply resets weak statuses to `new` so the lead surfaces in the Queue; it will never overwrite `booked`, `closed`, `dnd`, or `wrong_number` unless an operator uses a forced action."

Quick retest guidance:
- To verify idempotency and status policy in a dev sheet: (1) send an inbound to create/update a Queue row, (2) send a click/delivery twice with different timestamps and confirm `clicked_at` / `sent_at` do not change, (3) send STOP then START and confirm `do_not_text` and `status` reflect the consent flow.
