# Twilio error codes (observed)

Documenting the Twilio error codes seen in Ping logs for quick reference.

- `21610`: Message to this number is blocked (user replied STOP).
- `30003`: Unavailable/unknown destination handset.
- `30005`: Unknown destination handset or not reachable.
- `30006`: Landline or destination carrier does not support SMS (cannot deliver).

Ping tags: we log callbacks under `post` and `master-update-debug`. Delivery failures are tagged `delivery-fail` when status is failed/undelivered; consider also treating any non-empty `error_code` as a fail if desired.
