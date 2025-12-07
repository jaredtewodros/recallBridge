#!/usr/bin/env python3
"""
Send recall / continuing-care SMS from a CSV via Twilio.

Usage:
    python3 twilio_send_script.py /path/to/file.csv --touch t1
    python3 twilio_send_script.py /path/to/file.csv --touch t2
    python3 twilio_send_script.py /path/to/file.csv --dry-run
    python3 twilio_send_script.py /path/to/file.csv --force
    python3 twilio_send_script.py /path/to/file.csv --mode manual   # no scheduler link
    python3 twilio_send_script.py /path/to/file.csv --mode link     # with scheduler link (default)

Rules (CSV-driven; no sheet lookups):
- Require: e164_phone present and valid, do_not_text is FALSE.
- T1 include: status in {new, calling, lvm, texted, ""}, responded_at older than 14 days, no booked_at, t1_sent_at empty.
- T2 include: t1_sent_at set, t2_sent_at empty, do_not_text FALSE, status not in {booked, closed, wrong_number, dnd}, booked_at empty, no reply since T1 (responded_at empty or <= t1_sent_at), T1 age >= 72 hours.
- sent_status=sent rows are skipped unless --force.
- list_tag drives copy variant ("past_due" or "due_soon"); row-level "mode" overrides CLI --mode.
- in link mode, appends ?lt=<list_tag>&pn=<e164_phone> and uses Twilio link shortening.
"""

import csv
import os
import sys
import argparse
from datetime import datetime, timedelta, timezone
from urllib.parse import quote_plus
from templates import render_message
from twilio.rest import Client

# =====================================================================
# CONFIG
# =====================================================================

BOOKING_URL = "https://schedule.solutionreach.com/scheduling/subscriber/79395/scheduler"
OFFICE_PHONE = "301-656-7872"
MESSAGING_SERVICE_SID = "MGaf34766209ca8d189e1f03fef1f524f4"

TRUEY = {"true", "1", "yes", "y", "t"}
WORKABLE_STATUSES = {"", "new", "calling", "lvm", "texted"}
STRONG_STATUSES = {"booked", "closed", "wrong_number", "dnd"}
RECENT_REPLY_DAYS = 14
MIN_T2_HOURS = 72

def is_true(val):
    if val is None:
        return False
    return str(val).strip().lower() in TRUEY

def parse_ts(val):
    """
    Best-effort timestamp parser for ISO strings or Sheets datetime strings.
    Returns timezone-aware UTC datetime or None.
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
        return datetime.fromisoformat(s).astimezone(timezone.utc)
    except Exception:
        pass
    # Fallback: try common sheet format e.g., 11/24/2025 18:52:41
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None

def normalize_e164(val):
    """
    Normalize to +1XXXXXXXXXX (last 10 digits). Returns '' if not valid.
    """
    if val is None:
        return ""
    digits = "".join([c for c in str(val) if c.isdigit()])
    if len(digits) >= 10:
        core = digits[-10:]
        return "+1" + core
    return ""

def validate_csv(csv_path, preview_rows=10):
    required_headers = {
        "e164_phone",
        "list_tag",
        "FName",
        "LName",
        "do_not_text",
        "responded_at",
        "booked_at",
        "t1_sent_at",
        "t2_sent_at",
    }
    seen_phones = set()
    preview = []
    total = 0
    blanks = 0
    dups = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = set(reader.fieldnames or [])
        missing = required_headers - headers
        if missing:
            print(f"ERROR: Missing required headers: {', '.join(missing)}")
            return False
        for idx, row in enumerate(reader, start=1):
            total += 1
            phone = row.get("e164_phone", "").strip()
            if not phone:
                blanks += 1
            elif phone in seen_phones:
                dups += 1
            else:
                seen_phones.add(phone)
            if len(preview) < preview_rows:
                preview.append(row)
    print(f"\nCSV VALIDATION SUMMARY:")
    print(f"  Total rows: {total}")
    print(f"  Blank e164_phone: {blanks}")
    print(f"  Duplicate e164_phone: {dups}")
    print(f"  Unique e164_phone: {len(seen_phones)}")
    print(f"  Headers: {sorted(headers)}")
    print(f"\nPreview (first {preview_rows} rows):")
    for i, row in enumerate(preview, 1):
        print(f"  [{i}] {row}")
    if missing or blanks:
        print("\nERROR: Validation failed. Fix issues above or use --force to override.")
        return False
    if dups:
        print("\nWARNING: Duplicate e164_phone detected in CSV; duplicates will be skipped at send time.")
    print("\nValidation passed.")
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", help="Path to CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be sent")
    parser.add_argument("--force", action="store_true", help="Send even if sent_status == sent or validation fails")
    parser.add_argument("--mode", choices=["link", "manual"], default="link",
                        help="Default send mode; per-row 'mode' column overrides if present")
    parser.add_argument("--touch", choices=["t1", "t2"], default="t1",
                        help="Touch pass to run (t1 or t2). Rows are filtered per-touch.")
    parser.add_argument("--validate", action="store_true", help="Validate CSV and preview rows, then exit")
    args = parser.parse_args()

    if args.validate:
        ok = validate_csv(args.csv_path)
        sys.exit(0 if ok else 1)

    # Always validate unless --force
    if not args.force:
        ok = validate_csv(args.csv_path)
        if not ok:
            print("Aborting due to validation errors. Use --force to override.")
            sys.exit(1)

    # creds
    account_sid = os.getenv("TWILIO_ACCOUNT_SID")
    auth_token = os.getenv("TWILIO_AUTH_TOKEN")
    if not account_sid or not auth_token:
        print("ERROR: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set as env vars.")
        sys.exit(1)
    client = Client(account_sid, auth_token)

    now = datetime.now(timezone.utc)
    seen_phones = set()
    sent_count = 0
    skipped_reasons = {}
    error_count = 0

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            lname       = row.get("LName", "").strip()
            fname       = row.get("FName", "").strip()
            e164_raw    = row.get("e164_phone", "").strip()
            e164        = normalize_e164(e164_raw)
            do_not_text = row.get("do_not_text", "").strip()
            list_tag    = row.get("list_tag", "").strip()
            sent_status = row.get("sent_status", "").strip()
            row_mode    = (row.get("mode", "") or "").strip().lower()
            effective_mode = row_mode if row_mode in ("link", "manual") else args.mode
            status      = (row.get("status", "") or "").strip().lower()
            responded_at = parse_ts(row.get("responded_at"))
            booked_at    = parse_ts(row.get("booked_at"))
            t1_sent_at   = parse_ts(row.get("t1_sent_at") or row.get("sent_at"))
            t2_sent_at   = parse_ts(row.get("t2_sent_at"))

            reasons = []

            if is_true(do_not_text):
                reasons.append("do_not_text is true")
            if not e164:
                reasons.append("missing/invalid e164_phone")
            if status in STRONG_STATUSES:
                reasons.append(f"status={status} (strong)")
            if booked_at:
                reasons.append("booked_at present")
            if responded_at and (now - responded_at) < timedelta(days=RECENT_REPLY_DAYS):
                reasons.append(f"responded within {RECENT_REPLY_DAYS}d")
            if sent_status and sent_status.lower() == "sent" and not args.force:
                reasons.append("sent_status=sent (use --force to override)")
            if e164 and e164 in seen_phones:
                reasons.append("duplicate phone already processed in this file")

            if args.touch == "t1":
                if status not in WORKABLE_STATUSES:
                    reasons.append(f"status not workable ({status})")
                if t1_sent_at:
                    reasons.append("t1_sent_at already set")
            else:  # T2
                if not t1_sent_at:
                    reasons.append("no t1_sent_at (not eligible for T2)")
                if t2_sent_at:
                    reasons.append("t2_sent_at already set")
                if t1_sent_at and (now - t1_sent_at) < timedelta(hours=MIN_T2_HOURS):
                    reasons.append(f"T1 age < {MIN_T2_HOURS}h")
                if responded_at and t1_sent_at and responded_at > t1_sent_at:
                    reasons.append("reply received after T1")

            if reasons:
                print(f"[{idx}] SKIP {fname} {lname} — {', '.join(reasons)}")
                key = ";".join(reasons)
                skipped_reasons[key] = skipped_reasons.get(key, 0) + 1
                continue
            if e164:
                seen_phones.add(e164)

            # 4) construct body per mode
            body = ""
            if effective_mode == "link":
                # build tracking URL with list_tag + phone
                encoded_phone = quote_plus(e164)
                lt = quote_plus(list_tag) if list_tag else "due_soon"
                tracking_url = f"{BOOKING_URL}?lt={lt}&pn={encoded_phone}"
                print(f"mode=link tracking_url={tracking_url}")
                body = render_message(
                    mode="link",
                    list_tag=list_tag,
                    first=fname,
                    office_phone=OFFICE_PHONE,
                    short_url=tracking_url,
                    touch=args.touch,
                )
            else:
                # manual callback path (no link)
                print("mode=manual (no URL)")
                body = render_message(
                    mode="manual",
                    list_tag=list_tag,
                    first=fname,
                    office_phone=OFFICE_PHONE,
                    touch=args.touch,
                )

            if args.dry_run:
                print(f"[{idx}] DRY RUN -> to={e164} | body={body}")
                continue

            # 5) send via Twilio
            try:
                msg = client.messages.create(
                    messaging_service_sid=MESSAGING_SERVICE_SID,
                    to=e164,
                    body=body,
                    shorten_urls=True,  # no-op in manual mode; required in link mode
                    status_callback=None  # set at the Messaging Service level
                )
                print(f"[{idx}] SENT -> to={e164} sid={msg.sid} (mode={effective_mode}, touch={args.touch})")
                sent_count += 1
            except Exception as e:
                print(f"[{idx}] ERROR sending to {e164}: {e}")
                error_count += 1

    # End-of-run summary
    print("\n=== RUN SUMMARY ===")
    print(f"Total rows processed: {idx}")
    print(f"Sent: {sent_count}")
    print(f"Errors: {error_count}")
    if skipped_reasons:
        print("Skipped by reason:")
        for reason, count in sorted(skipped_reasons.items(), key=lambda x: x[1], reverse=True):
            print(f"  {count} -> {reason}")
    print("Done.")

if __name__ == "__main__":
    main()
