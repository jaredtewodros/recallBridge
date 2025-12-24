// Invariants.js - stats, invariant checks, and summaries

function normalizeBool_(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === 1 || v === "1") return true;
  if (v === 0 || v === "0") return false;
  const s = (v || "").toString().trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "t";
}

function computeStatsFromSheets_(practiceSheetId) {
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const stats = {
    schema_version: "dry_run_harness_v1",
    practice_id: cfg.practice_id || "",
    raw_rows: 0,
    patients_total: 0,
    patients_with_phone_e164: 0,
    patients_has_sms_contact_true: 0,
    patients_do_not_text_true: 0,
    patients_complaint_flag_true: 0,
    recall_due_date_parse_fail_count: 0,
    missing_patient_key_count: 0,
    missing_external_patient_id_count: 0,
    queue_total: 0,
    queue_eligible: 0,
    queue_ineligible: 0,
    queue_ineligible_by_reason: {},
    import_source_file_id: cfg.last_import_source_file_id || null,
    import_archived_file_id: cfg.last_import_archived_file_id || null,
    import_timestamp: cfg.last_imported_at || null,
    computed_at: new Date().toISOString()
  };

  // Import_Raw
  const rawSh = getSheetByName(ss, "20_Import_Raw");
  if (rawSh) {
    const data = rawSh.getDataRange().getValues();
    if (data.length > 1) {
      const rows = data.slice(1).filter(function (r) {
        return r.some(function (c) { return String(c || "").trim() !== ""; });
      });
      stats.raw_rows = rows.length;
    }
  }

  // Patients
  const pSh = getSheetByName(ss, "30_Patients");
  if (pSh) {
    const data = pSh.getDataRange().getValues();
    if (data.length > 1) {
      const header = data[0];
      const hmap = headerMap(header);
      data.slice(1).forEach(function (row) {
        const pk = row[hmap["patient_key"]] || "";
        const extId = row[hmap["external_patient_id"]] || "";
        const phone = row[hmap["phone_e164"]] || "";
        const hasSms = normalizeBool_(row[hmap["has_sms_contact"]]);
        const dnt = normalizeBool_(row[hmap["do_not_text"]]);
        const complaint = normalizeBool_(row[hmap["complaint_flag"]]);
        const recallDate = row[hmap["recall_due_date"]] || "";
        const recallStatus = row[hmap["recall_status"]] || "";
        const nonEmpty = header.some(function (_, idx) { return String(row[idx] || "").trim() !== ""; });
        if (!nonEmpty) return;
        if (!pk) stats.missing_patient_key_count += 1;
        if (!extId) stats.missing_external_patient_id_count += 1;
        if (pk) stats.patients_total += 1;
        if (phone) stats.patients_with_phone_e164 += 1;
        if (hasSms) stats.patients_has_sms_contact_true += 1;
        if (dnt) stats.patients_do_not_text_true += 1;
        if (complaint) stats.patients_complaint_flag_true += 1;
        if (recallDate && String(recallStatus).toUpperCase() === "UNKNOWN") stats.recall_due_date_parse_fail_count += 1;
      });
    }
  }

  // Queue
  const qSh = getSheetByName(ss, "50_Queue");
  if (qSh) {
    const data = qSh.getDataRange().getValues();
    if (data.length > 1) {
      const header = data[0];
      const hmap = headerMap(header);
      data.slice(1).forEach(function (row) {
        const pk = row[hmap["patient_key"]] || "";
        if (!pk) return;
        const eligible = normalizeBool_(row[hmap["eligible"]]);
        const reason = (row[hmap["ineligible_reason"]] || "").toString().trim() || "(blank)";
        stats.queue_total += 1;
        if (eligible) {
          stats.queue_eligible += 1;
        } else {
          stats.queue_ineligible += 1;
          stats.queue_ineligible_by_reason[reason] = (stats.queue_ineligible_by_reason[reason] || 0) + 1;
        }
      });
    }
  }

  return stats;
}

function logRunSummary_(practiceSheetId, runId, phaseName, statsObject) {
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const practiceId = statsObject.practice_id || "";
  const notes = "Run summary: patients_total=" + statsObject.patients_total + ", queue_eligible=" + statsObject.queue_eligible;
  logEvent(ss, EVENT_TYPES.RUN_SUMMARY, runId, practiceId, notes, statsObject);
}

function AssertInvariants_(practiceSheetId, runId, statsObject) {
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id || "";

  const minSmsRate = parseFloat(cfg.invariant_min_sms_contact_rate || 0.30);
  const maxInvalidRecallRate = parseFloat(cfg.invariant_max_invalid_recall_date_rate || 0.10);
  const allowZeroEligible = normalizeBool_(cfg.invariant_allow_zero_eligible || false);
  const queueMode = (cfg.invariant_queue_mode || "ALL_PATIENTS").toUpperCase();

  const failures = [];
  const pushFail = function (code, msg, details) {
    failures.push({ code: code, message: msg, details: details || {} });
  };

  // Invariants
  if (statsObject.patients_total <= 0) pushFail("I1", "patients_total must be > 0", { patients_total: statsObject.patients_total });

  if (queueMode === "ALL_PATIENTS") {
    if (statsObject.queue_total <= 0) pushFail("I2", "queue_total must be > 0", { queue_total: statsObject.queue_total });
    if (statsObject.queue_total !== statsObject.patients_total) {
      pushFail("I3", "queue_total must equal patients_total", { queue_total: statsObject.queue_total, patients_total: statsObject.patients_total });
    }
  } else if (queueMode === "ELIGIBLE_ONLY") {
    if (statsObject.queue_total < statsObject.queue_eligible) {
      pushFail("I3", "queue_total must be >= queue_eligible for ELIGIBLE_ONLY", { queue_total: statsObject.queue_total, queue_eligible: statsObject.queue_eligible });
    }
  }

  if (!allowZeroEligible && statsObject.queue_eligible <= 0) {
    pushFail("I4", "queue_eligible must be > 0", { queue_eligible: statsObject.queue_eligible });
  }

  const smsRate = statsObject.patients_total > 0 ? statsObject.patients_has_sms_contact_true / statsObject.patients_total : 0;
  if (smsRate < minSmsRate) pushFail("I5", "sms_contact_rate below threshold", { sms_rate: smsRate, min_sms_rate: minSmsRate });

  const invalidRecallRate = statsObject.patients_total > 0 ? statsObject.recall_due_date_parse_fail_count / statsObject.patients_total : 0;
  if (invalidRecallRate > maxInvalidRecallRate) pushFail("I6", "invalid recall date rate above threshold", { invalid_rate: invalidRecallRate, max_invalid_rate: maxInvalidRecallRate });

  if (statsObject.missing_patient_key_count > 0) {
    pushFail("I7a", "missing patient_key rows", { missing_patient_key_count: statsObject.missing_patient_key_count });
  }
  if (statsObject.missing_external_patient_id_count > 0) {
    pushFail("I7b", "missing external_patient_id rows", { missing_external_patient_id_count: statsObject.missing_external_patient_id_count });
  }

  if (failures.length) {
    const payload = {
      schema_version: "dry_run_harness_v1",
      run_id: runId,
      practice_id: practiceId,
      failures: failures,
      stats: statsObject
    };
    const notes = "Invariant failures: " + failures.map(function (f) { return f.code; }).join(", ");
    logEvent(ss, EVENT_TYPES.RUN_INVARIANTS_FAIL, runId, practiceId, notes, payload);
    throw new Error(notes);
  } else {
    logEvent(ss, EVENT_TYPES.RUN_INVARIANTS_PASS, runId, practiceId, "Invariants pass", statsObject);
  }
}
