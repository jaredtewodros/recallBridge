// EventLog.js - append-only audit log

function logEvent(ss, eventType, runIdVal, practiceId, notes, payloadObj, extras) {
  const sh = getSheetByName(ss, "70_EventLog");
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const hmap = headerMap(header);
  const row = new Array(header.length).fill("");
  row[hmap["event_id"]] = Utilities.getUuid();
  row[hmap["event_type"]] = eventType;
  row[hmap["run_id"]] = runIdVal;
  row[hmap["occurred_at"]] = nowIso();
  if (hmap["practice_id"] !== undefined) row[hmap["practice_id"]] = practiceId || "";
  if (hmap["notes"] !== undefined) row[hmap["notes"]] = notes || "";
  if (hmap["payload_json"] !== undefined) row[hmap["payload_json"]] = payloadObj ? JSON.stringify(payloadObj) : "";
  if (extras && typeof extras === "object") {
    Object.keys(extras).forEach(function (k) {
      if (hmap[k] !== undefined) {
        row[hmap[k]] = extras[k];
      }
    });
  }
  sh.appendRow(row);
}
