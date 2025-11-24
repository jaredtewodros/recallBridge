#!/usr/bin/env python3
"""
Send recall / continuing-care SMS from a CSV via Twilio.

Usage:
    python3 twilio_send_script.py /path/to/file.csv
    python3 twilio_send_script.py /path/to/file.csv --dry-run
    python3 twilio_send_script.py /path/to/file.csv --force
    python3 twilio_send_script.py /path/to/file.csv --mode manual   # no scheduler link
    python3 twilio_send_script.py /path/to/file.csv --mode link     # with scheduler link (default)

Rules:
- skips rows with do_not_text == TRUE/True/true/1/y/yes
- skips rows with no e164_phone
- if CSV has a column named "sent_status" and it is "sent", SKIP unless --force
- list_tag drives copy variant ("past_due" or "due_soon")
- row-level "mode" column overrides CLI --mode if present (values: "link" or "manual")
- in link mode, appends ?lt=<list_tag>&pn=<e164_phone> and uses Twilio link shortening
"""

import csv
import os
import sys
import argparse
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

def is_true(val):
    if val is None:
        return False
    return str(val).strip().lower() in TRUEY


def validate_csv(csv_path, preview_rows=10):
    required_headers = {"e164_phone", "list_tag", "FName", "LName"}
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
    if missing or blanks or dups:
        print("\nERROR: Validation failed. Fix issues above or use --force to override.")
        return False
    print("\nValidation passed.")
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", help="Path to CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be sent")
    parser.add_argument("--force", action="store_true", help="Send even if sent_status == sent or validation fails")
    parser.add_argument("--mode", choices=["link", "manual"], default="link",
                        help="Default send mode; per-row 'mode' column overrides if present")
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

    with open(args.csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, start=1):
            lname       = row.get("LName", "").strip()
            fname       = row.get("FName", "").strip()
            e164        = row.get("e164_phone", "").strip()
            do_not_text = row.get("do_not_text", "").strip()
            list_tag    = row.get("list_tag", "").strip()
            sent_status = row.get("sent_status", "").strip()
            row_mode    = (row.get("mode", "") or "").strip().lower()
            effective_mode = row_mode if row_mode in ("link", "manual") else args.mode

            # 1) skip if do_not_text
            if is_true(do_not_text):
                print(f"[{idx}] SKIP {fname} {lname} — do_not_text is true")
                continue

            # 2) skip if no phone
            if not e164:
                print(f"[{idx}] SKIP {fname} {lname} — missing e164_phone")
                continue

            # 3) skip if already sent (unless --force)
            if sent_status and sent_status.lower() == "sent" and not args.force:
                print(f"[{idx}] SKIP {fname} {lname} — sent_status=sent (use --force to override)")
                continue

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
                )
            else:
                # manual callback path (no link)
                print("mode=manual (no URL)")
                body = render_message(
                    mode="manual",
                    list_tag=list_tag,
                    first=fname,
                    office_phone=OFFICE_PHONE,
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
                print(f"[{idx}] SENT -> to={e164} sid={msg.sid} (mode={effective_mode})")
            except Exception as e:
                print(f"[{idx}] ERROR sending to {e164}: {e}")

    print("Done.")

if __name__ == "__main__":
    main()
