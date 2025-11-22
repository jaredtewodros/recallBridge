# templates.py

from typing import Optional

OPT_OUT_FOOTER = " Reply STOP to opt out."

def _norm_list_tag(tag: Optional[str]) -> str:
    if not tag:
        return "due_soon"
    t = str(tag).strip().lower()
    return "past_due" if t == "past_due" else "due_soon"

def _greeting(first: Optional[str]) -> str:
    first = (first or "").strip()
    return first if first else "there"

def render_link_mode(
    *,
    list_tag: Optional[str],
    first: Optional[str],
    short_url: str,
    office_phone: str,
    include_opt_out: bool = True,
) -> str:
    """
    Scheduler link flow: includes shortened URL and Questions line.
    """
    tag = _norm_list_tag(list_tag)
    name = _greeting(first)

    if tag == "past_due":
        body = (
            f"Hi {name}, this is Bethesda Dental Smiles. "
            f"Your recall/cleaning is past due. "
            f"Book here: {short_url}\n\n"
            f"Questions? Call {office_phone}."
        )
    else:
        # due_soon
        body = (
            f"Hi {name}, this is Bethesda Dental Smiles. "
            f"You’re due for your next hygiene/recall visit. "
            f"Book here: {short_url}\n\n"
            f"Questions? Call {office_phone}."
        )

    if include_opt_out:
        body += OPT_OUT_FOOTER
    return body


def render_manual_mode(
    *,
    list_tag: Optional[str],
    first: Optional[str],
    office_phone: str,
    include_opt_out: bool = True,
) -> str:
    """
    No-scheduler/manual callback flow: asks for YES or CALL ME. No links.
    """
    tag = _norm_list_tag(list_tag)
    name = _greeting(first)

    if tag == "past_due":
        lead = "Your recall/cleaning is past due."
    else:
        lead = "You’re due for your next hygiene/recall visit."

    body = (
        f"Hi {name}, this is Bethesda Dental Smiles. {lead} "
        f"Reply YES and we’ll call to schedule. Prefer a call now? Text CALL ME.\n\n"
        f"Questions? Call {office_phone}."
    )

    if include_opt_out:
        body += OPT_OUT_FOOTER
    return body


# Optional helper: single entry point if you prefer one function.
def render_message(
    *,
    mode: str,  # "link" or "manual"
    list_tag: Optional[str],
    first: Optional[str],
    office_phone: str,
    short_url: Optional[str] = None,
    include_opt_out: bool = True,
) -> str:
    mode = (mode or "link").strip().lower()
    if mode == "manual":
        return render_manual_mode(
            list_tag=list_tag,
            first=first,
            office_phone=office_phone,
            include_opt_out=include_opt_out,
        )
    # default: link mode requires a URL
    if not short_url:
        raise ValueError("short_url is required for link mode")
    return render_link_mode(
        list_tag=list_tag,
        first=first,
        short_url=short_url,
        office_phone=office_phone,
        include_opt_out=include_opt_out,
    )
