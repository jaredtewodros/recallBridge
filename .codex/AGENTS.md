# RecallBridge — Agents Guide (for Codex)

> **What it is:** RecallBridge is software for dental practices that **prevents unused dental benefits from expiring** and **drives recall hygiene visits**. It identifies eligible patients, contacts them (SMS-first), and routes replies into a lightweight workflow so staff can book appointments or tag outcomes.
> **Why it matters:** Practices lose revenue when patients don’t use year-end insurance benefits or miss recall windows. RecallBridge turns that leakage into scheduled visits with minimal staff effort.

---

## 1) Business Objectives

* **Primary outcome:** Book more eligible patients before their **benefits expire** and keep **recall intervals** on track.
* **North-star KPIs (pilot)**

  * Outreach → **Delivery rate** (transport health)
  * Delivery → **Click/intent rate** (if using link mode)
  * Intent/Inbound → **Booked rate**
  * Cancel leakage → **DND/STOP rate** (compliance + list hygiene)
* **Constraints (pilot/MVP):**

  * Use **SMS** (Twilio) with **minimal PHI**.
  * Use **Google Sheets** as the provisional system of record (SoR).
  * Keep **operator workflow** dead simple (single “Queue” view + color legend).
  * Be able to run **Link Mode** (with online scheduling link) or **Manual Mode** (no link; staff closes the loop).

---

## 2) Users & Jobs to Be Done

* **Office Manager / Front Desk**: See new replies, call or text back, book, tag outcomes, mark wrong numbers.
* **Practice Owner / Ops**: See throughput/booking metrics; ensure compliant messaging; export results.
* **RecallBridge Operator (us)**: Run sends, monitor callbacks, ensure idempotency, triage errors without breaking flow.

---

## 3) Operating Modes

* **Link Mode (preferred):** SMS includes a tracked link to online scheduling. We record `clicked_at` on open.
* **Manual Mode (fallback):** SMS without a link; staff uses the **Queue** sheet to work replies and book manually.
* Both modes share the same **inbound auto-reply**, **consent handling**, and **idempotent logging**.

---

## 4) Data Model (MVP on Google Sheets)

> Two core tabs; one diagnostic tab. Column names must match exactly.

### 4.1 Master (Outbound / Event Ledger)

* **Columns (required):**
  `e164_phone` (string, +1XXXXXXXXXX or normalized last 10)
  `sent_at` (ISO or datetime; set on delivery)
  `clicked_at` (ISO or datetime; first-click wins)
  `followup_stage` (number; 1=sent, 2=clicked)
  `do_not_text` (TRUE/FALSE; consent state)
* **Behavior:**

  * On **delivery** event → set `sent_at` (idempotent: only if empty).
  * On **click** event → set `clicked_at` (idempotent: only if empty).
  * On **STOP** → `do_not_text=TRUE`.
  * On **START/UNSTOP** → clear `do_not_text`.

### 4.2 Queue (Inbound / Agent Workflow)

* **Columns (required):**
  `e164_phone, F_name, L_name, list_tag, responded_at, agent_attempts, last_action_at, next_action_at, status, notes, key`
* **Allowed `status` values** (data-validated):
  `new, calling, lvm, texted, booked, closed, dnd, wrong_number`
* **Behavior:**

  * **Inbound SMS** (new or reply) → **upsert** row by phone:

    * `responded_at` = now, `last_action_at` = now
    * `notes` append first ~120 chars of inbound text (pipe-delimited history)
    * **Status policy (weak vs strong):**

      * *Weak statuses* that **may** be set to `new` on inbound: `{ "", "new", "texted" }`
      * *Strong statuses* that **must not** be overwritten by plain inbound: `{ "calling", "lvm", "booked", "closed", "dnd", "wrong_number" }`
  * **STOP** → set `status="dnd"` and append to `notes`.
  * **START/UNSTOP** → set `status="new"` (or leave strong statuses untouched if business policy requires).

### 4.3 Ping (Diagnostics)

* For **sanity pings** and **raw payload journaling** only.
* Not a SoR; keep write volume minimal. Use a separate **Debug** sheet for failure-only dumps if needed.

---

## 5) Event Flows

**All inbound webhooks come through a Google Apps Script Web App (`doPost`)**. Twilio Functions can act as a front door if desired (auto-reply + forward to Apps Script).

### 5.1 Outbound Send → Delivery

1. Campaign triggers Twilio message.
2. Twilio **status callback** hits `doPost` with `MessageStatus=sent|delivered`.
3. `doPost` finds `Master` row by **To** phone.
4. **Idempotency:** set `sent_at` only if empty. If `followup_stage` empty, set `=1`.

### 5.2 Click Tracking (Link Mode)

1. Patient clicks tracked link (via our redirect).
2. Redirect calls `doPost` with `{ event_type: "click", to, clicked_at }`.
3. **Idempotency:** set `clicked_at` only if empty; set `followup_stage=2`.

### 5.3 Inbound SMS (Replies)

1. Twilio sends inbound to our Twilio Function → **auto-reply** (“Thanks for your message…”), then forwards JSON to Apps Script with `{ event_type: "inbound", from, to, body }`.
2. Apps Script **upserts** into `Queue` by **From** phone and applies **status policy** above.
3. Notes are appended with a compact snippet of the inbound message.

### 5.4 Consent (STOP/START/UNSTOP) — **Must-have**

* **STOP**

  * Master: `do_not_text=TRUE`
  * Queue: `status="dnd"`, append `notes`
  * Respect opt-out on all future sends
* **START / UNSTOP**

  * Master: clear `do_not_text`
  * Queue: set `status="new"` (or leave strong statuses per policy)
* **Auto-reply during quiet hours:** **not suppressed** (patients get acknowledgement 24/7).
* **Copies** include an opt-out line: *“Reply STOP to opt out.”*

---

## 6) Idempotency Rules (MVP)

* **Delivery (`sent_at`)**: set **only if empty**.
* **Click (`clicked_at`)**: set **only if empty** (“first click wins”).
* **Inbound upsert**: single row per phone in `Queue`; `notes` concatenates; timestamps update.
* **Status**: never downgrade **strong** statuses on plain inbound.

---

## 7) Security & Privacy (Pilot)

* **Shared Secret Header** (optional, off for MVP): `X-RB-Key: <secret>` — enforced at Apps Script; mirrored in Twilio Functions.
* **PHI**: Don’t place diagnoses/procedures in SMS. Identify only by name or generic appointment language.
* **Access**: Apps Script web app deployed as **Anyone** for pilot; flip to secret-gated post-pilot.

---

## 8) Staff Workflow (Queue)

* Work the **saved filter view**: “Today’s Replies” (status in `{new,texted,calling,lvm}`, `responded_at`=today).
* Update `status` as you act: `calling` → `lvm` or `booked` → `closed`.
* Use `notes` to keep quick context (system also appends inbound snippets).
* **Color legend** pinned in sheet header (first frozen rows) so highlights are self-explanatory.

---

## 9) QA Checklist (MVP)

1. **Manual send → delivery:** verify `sent_at` and `followup_stage=1`.
2. **Inbound reply:** verify `Queue` row upserted, `responded_at/last_action_at` set, `notes` appended.
3. **Status edits stick:** change `status` to `calling` → `lvm`; send a plain inbound; verify **no overwrite**.
4. **Click idempotency:** send two click events; verify first timestamp persists.
5. **STOP → START:** STOP sets `do_not_text=TRUE` (Master) and `status=dnd` (Queue); START clears and returns to `new`.

---

## 10) Architecture (MVP)

* **Twilio Functions**

  * `/inbound-reply`: auto-reply, then POST JSON to Apps Script.
  * (Optional) `/bds-link-click` style redirect for click tracking.
* **Apps Script Web App**

  * Single `doPost` → routes **inbound**, **delivery**, **click**, **STOP/START** to Master/Queue.
  * Minimal logging to **Ping**; failure-only dumps to **Debug** (optional).
  * **Idempotency** baked into sheet updates (first-write wins).

> **Rationale:** Sheets are the SoR in pilot for speed and visibility. We’ll graduate to a DB when volume/stability demands it.

---

## 11) Coding Conventions (for Codex)

* **Languages/Hosts:**

  * **Twilio Functions**: Node 16/18 (CommonJS), fetch/axios allowed.
  * **Apps Script**: V8 runtime; `SpreadsheetApp`, `ContentService`.
* **Phone normalization:** keep last 10 digits; store/display E.164 (`+1XXXXXXXXXX`) when possible.
* **Headers:** accept both `camel` and `Title` cases from Twilio (`MessageStatus`, `From`, etc.).
* **Hardening:** never assume a column index; always resolve by header string.
* **Idempotency pattern:** “set only if empty” for first-wins fields; never blindly overwrite strong statuses.
* **Config:** centralize sheet/tab names and status sets in top-level constants.
* **Schema source of truth:** `docs/sheets.schema.json` — Master required headers (e164_phone, sent_at, t1_sent_at, t2_sent_at, clicked_at, booked_at, responded_at, followup_stage, do_not_text). Queue columns include LastVisit (mirror of Master.LastVisit for recency checks). Always resolve by header name, not index.
* **Twilio error codes:** see `docs/twilio_errors.md` (21610 STOP; 30003 unavailable; 30005 unknown/not reachable; 30006 landline/carrier no SMS).

---

## 12) Environments & Placeholders

* **Do not commit client secrets.** Use environment variables in Twilio; Apps Script can keep a constant that’s toggled at deploy time.
* **Placeholders in code:**

  * `{{TWILIO_MESSAGING_SERVICE_SID}}`, `{{TWILIO_API_KEY}}`
  * `{{APPS_SCRIPT_EXEC_URL}}` for function forwarders
  * `{{SHEET_ID}}`, `{{TAB_MASTER}}`, `{{TAB_QUEUE}}`
* **Toggle flags:**

  * `ENFORCE_KEY = false` (pilot)
  * `QUIET_HOURS_FOR_AUTOREPLY = false` (we always auto-reply)

---

## 13) Future Roadmap (post-pilot)

* Replace Sheets with a **database** (row-level idempotency keys, audit tables).
* Deep PMS integrations (OpenDental, Dentrix, Eaglesoft) for eligibility & scheduling.
* Role-based UI replacing sheet workflow; per-practice templates and quiet-hours governance.
* Metrics dashboards (booked rate by segment, benefit recapture $, contactability by cohort).
* Full consent ledger (per-number history) and deliverability monitoring.

---

## 14) What Codex Should Build/Change (typical tasks)

* Implement/adjust **status policies** without breaking strong statuses.
* Maintain/update **idempotency guards** for `sent_at` and `clicked_at`.
* Harden **inbound parsing** (JSON vs form) and expand **STOP/START** synonyms.
* Keep **column-name resolution** robust when sheets add columns.
* Add **kill switch** cell (Config tab) to no-op webhook if set to OFF.
* Keep **Ping** low-noise; add **Debug** failure logging with capped rows.

---

## 15) Ground Truth (non-client-specific)

* MVP uses **Twilio → (auto-reply) → Apps Script** to log delivery/click/inbound in Sheets.
* **Idempotency**: first-wins for `clicked_at` and `sent_at`.
* **Consent**: STOP/START fully wired; STOP maps to `dnd` in Queue, `do_not_text=TRUE` in Master; START clears and returns to `new` (unless policy says keep strong statuses).
* **Auto-reply** is always on; quiet hours do not suppress the acknowledgment.
* **Queue color legend** and staff filter view matter; Codex should not disrupt those columns or validations.

**Headers source of truth**
- The live sheet header schemas (Master, Queue, Pilot Dashboard) mirror `Bethesda Dental Smiles/docs/sheets.schema.json`. Do not assume column order; resolve by header names documented there.

---

### Appendices

**Allowed statuses (Queue):** `new, calling, lvm, texted, booked, closed, dnd, wrong_number`
**Weak statuses (overwrite to `new` on inbound):** `"" (empty), "new", "texted"`
**Strong statuses (never overwritten by plain inbound):** `"calling","lvm","booked","closed","dnd","wrong_number"`

---

**Author’s note to Codex:** Your mandate is to keep the pilot **predictable**. If you must choose between “more features” and “fewer surprises for staff,” choose the latter. Idempotency and consent correctness beat cleverness every time.
