import os, csv, re, time, argparse
from datetime import datetime
from dateutil import tz
from twilio.rest import Client
from twilio.base.exceptions import TwilioException

# --------- Fixed booking link (hardcoded) ----------
BOOKING_URL = "https://schedule.solutionreach.com/scheduling/subscriber/79395/scheduler"
BRAND_NAME  = "Bethesda Dental Smiles"
# ---------------------------------------------------

# Env-driven secrets (recommended: set in your shell)
ACCOUNT_SID     = os.getenv("TWILIO_ACCOUNT_SID")
AUTH_TOKEN      = os.getenv("TWILIO_AUTH_TOKEN")
API_KEY_SID     = os.getenv("TWILIO_API_KEY_SID")
API_KEY_SECRET  = os.getenv("TWILIO_API_KEY_SECRET")
MSG_SERVICE_SID = os.getenv("TWILIO_MESSAGING_SERVICE_SID")  # MG...

QUIET_START_HOUR = int(os.getenv("QUIET_START_HOUR", "9"))   # 9am ET
QUIET_END_HOUR   = int(os.getenv("QUIET_END_HOUR", "19"))    # 7pm ET
RATE_PER_SEC     = float(os.getenv("RATE_PER_SEC", "1"))     # 1 msg/sec

if not ACCOUNT_SID:
    raise SystemExit("Set TWILIO_ACCOUNT_SID")
if not (AUTH_TOKEN or (API_KEY_SID and API_KEY_SECRET)):
    raise SystemExit("Set TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/SECRET")
if not MSG_SERVICE_SID:
    raise SystemExit("Set TWILIO_MESSAGING_SERVICE_SID (MG...)")

client = Client(API_KEY_SID, API_KEY_SECRET, ACCOUNT_SID) if (API_KEY_SID and API_KEY_SECRET) else Client(ACCOUNT_SID, AUTH_TOKEN)

eastern = tz.gettz("America/New_York")
e164_us = re.compile(r"^\+1\d{10}$")

def within_quiet_hours(now_et: datetime) -> bool:
    return QUIET_START_HOUR <= now_et.hour < QUIET_END_HOUR

def derive_tag_from_filename(path: str) -> str:
    name = os.path.basename(path).lower()
    if "past" in name:
        return "past_due"
    if "soon" in name:
        return "due_soon"
    return "due_soon"

def build_message(tag: str) -> str:
    if tag == "past_due":
        base = (f"{BRAND_NAME}: You’re past due for a routine visit. "
                f"You may have remaining 2025 dental benefits that can cover this visit.")
    else:
        base = (f"{BRAND_NAME}:\n\nYou’re due for a visit. "
                f"You may have remaining 2025 dental benefits that can cover this visit.")
    return f"{base}\nSchedule an appointment at {BOOKING_URL}.\n\nQuestions? Call 301-656-7872. Reply STOP to opt out."

def normalize_us_phone(raw: str) -> str:
    if not raw: return ""
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:  return "+1" + digits
    if len(digits) == 11 and digits.startswith("1"): return "+" + digits
    if raw.startswith("+1") and len(digits) == 11:   return raw
    return ""

def main(csv_path: str, dry_run: bool):
    now_et = datetime.now(tz=eastern)
    if not within_quiet_hours(now_et):
        print(f"Outside quiet hours ({QUIET_START_HOUR}:00–{QUIET_END_HOUR}:00 ET). Exiting.")
        return

    sent, skipped = 0, 0
    default_tag = derive_tag_from_filename(csv_path)

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            phone = (row.get("e164_phone") or "").strip()
            if not phone:
                phone = normalize_us_phone((row.get("HPhone") or "").strip())
            if not phone or not e164_us.match(phone):
                skipped += 1
                continue

            dnd = (row.get("do_not_text","") or "").strip().lower() in ("true","1","yes","y")
            if dnd:
                skipped += 1
                continue

            tag = (row.get("list_tag","") or "").strip().lower()
            if tag not in ("due_soon", "past_due"):
                tag = default_tag

            body = build_message(tag)

            if dry_run:
                print(f"[DRY RUN] Would send to {phone}: {body}")
                sent += 1
                continue

            try:
                msg = client.messages.create(
                    messaging_service_sid=MSG_SERVICE_SID,
                    to=phone,
                    body=body,
                    shorten_urls=True,
                )
                print(f"Queued {phone} :: {msg.sid}")
                sent += 1
            except TwilioException as e:
                print(f"ERROR sending to {phone}: {e}")
                skipped += 1

            if RATE_PER_SEC > 0:
                time.sleep(1.0 / RATE_PER_SEC)

    print(f"Done. Sent/Queued: {sent} | Skipped: {skipped}")

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Send HIPAA-safe benefit SMS via Twilio Messaging Service.")
    p.add_argument("csv", help="Path to CSV with headers: LName,FName,HPhone,e164_phone,do_not_text,LastVisit,CC_DueDate,CC_TypeName,list_tag")
    p.add_argument("--dry-run", action="store_true", help="Print messages without sending")
    args = p.parse_args()
    main(args.csv, args.dry_run)
