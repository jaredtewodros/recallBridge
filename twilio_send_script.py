#!/usr/bin/env python3
import csv
import argparse
import os
from datetime import datetime
from twilio.rest import Client

# ================== CONFIG ==================
TWILIO_ACCOUNT_SID = os.environ["TWILIO_ACCOUNT_SID"]
TWILIO_AUTH_TOKEN = os.environ["TWILIO_AUTH_TOKEN"]

# hardcode to be sure we use the service that has link shortening
MESSAGING_SERVICE_SID = "MGaf34766209ca8d189e1f03fef1f524f4"


BOOKING_LINK = "https://schedule.solutionreach.com/scheduling/subscriber/79395/scheduler"
CALLBACK_NUMBER = "301-656-7872"
# ============================================

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

def _truthy(v: str) -> bool:
    return str(v).strip().lower() in ("true", "1", "yes", "y")

def classify_row(row: dict) -> str:
    """
    Return one of:
      - "initial"
      - "no-click"
      - "clicked-no-book"
      - "skip"
    based ONLY on the row values.
    """
    if _truthy(row.get("do_not_text", "")):
        return "skip"

    if row.get("booked_at", "").strip():
        return "skip"

    sent_at = row.get("sent_at", "").strip()
    clicked_at = row.get("clicked_at", "").strip()
    followup_stage_raw = row.get("followup_stage", "").strip()
    try:
        followup_stage = int(followup_stage_raw) if followup_stage_raw else 0
    except ValueError:
        followup_stage = 0

    # never texted
    if not sent_at:
        return "initial"

    # texted, never clicked, and we haven't followed up yet
    if sent_at and not clicked_at and followup_stage < 1:
        return "no-click"

    # clicked, not booked, and we haven't done the 2nd followup yet
    if clicked_at and not row.get("booked_at", "").strip() and followup_stage < 2:
        return "clicked-no-book"

    return "skip"

def build_message(row: dict, action: str) -> str:
    fname = (row.get("FName") or "").strip() or "there"
    list_tag = (row.get("list_tag") or "").strip()

    # tag the URL so the click webhook can tell which list
    if list_tag:
        link = f"{BOOKING_LINK}?lt={list_tag}"
    else:
        link = BOOKING_LINK

    # slight copy tweak by action
    if action == "clicked-no-book":
        # they showed interest
        body = (
            f"Hi {fname}, this is Bethesda Dental Smiles. Looks like you checked our schedule but didn’t grab a time. "
            f"Book here: {link}\n\n"
            f"Questions? Call {CALLBACK_NUMBER}. Reply STOP to opt out."
        )
    else:
        # initial + no-click
        body = (
            f"Hi {fname}, this is Bethesda Dental Smiles. You're due for a dental visit. "
            f"Book here: {link}\n\n"
            f"Questions? Call {CALLBACK_NUMBER}. Reply STOP to opt out."
        )
    return body

def main(csv_path: str, only_mode: str = None, dry_run: bool = False):
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            to_number = (row.get("e164_phone") or "").strip()
            if not to_number:
                continue

            action = classify_row(row)

            # if user said "only send this type today", obey
            if only_mode and action != only_mode:
                continue

            if action == "skip":
                continue

            body = build_message(row, action)

            if dry_run:
                print(f"[DRY RUN][{action}] -> {to_number}: {body}")
            else:
                msg = client.messages.create(
                    to=to_number,
                    messaging_service_sid=MESSAGING_SERVICE_SID,
                    body=body,
                    shorten_urls=True,
                )
                # we don't write back to CSV here (to avoid overwriting file),
                # we just log so you can paste into Sheets if needed
                now_iso = datetime.utcnow().isoformat()
                print(f"[SENT][{action}] {to_number} sid={msg.sid} at={now_iso}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path")
    parser.add_argument(
        "--only-mode",
        choices=["initial", "no-click", "clicked-no-book"],
        help="optionally force a single mode for this run",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    main(args.csv_path, args.only_mode, args.dry_run)
