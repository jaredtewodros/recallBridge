// EventLog.js - append-only audit log

function logEvent(ss, eventType, runIdVal, practiceId, notes, payloadObj) {
  const sh = getSheetByName(ss, "70_EventLog");
  const row = [
    Utilities.getUuid(),
    eventType,
    runIdVal,
    nowIso(),
    practiceId || "",
    notes || "",
    payloadObj ? JSON.stringify(payloadObj) : ""
  ];
  sh.appendRow(row);
}
