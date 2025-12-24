// DentrixImport.js - parse Import_Raw into Patients

function ImportDentrixFromRaw(practiceSheetId) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id;
  logEvent(ss, EVENT_TYPES.IMPORT_START, rid, practiceId, "ImportDentrixFromRaw", {});
  try {
    const raw = getSheetByName(ss, "20_Import_Raw");
    const values = raw.getDataRange().getValues();
    if (values.length < 2) throw new Error("Import_Raw empty");

    const header = values[0];
    const hmap = headerMap(header);
    const patientsSh = getSheetByName(ss, "30_Patients");
    const pData = patientsSh.getDataRange().getValues();
    const pHeader = pData[0];
    headerMap(pHeader); // duplicates guard

    const pMap = {};
    for (let i = 1; i < pData.length; i++) {
      const row = pData[i];
      const pk = row[pHeader.indexOf("patient_key")];
      if (pk) pMap[pk] = row;
    }

    let inserts = 0, updates = 0, parsed = 0;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (!row || row.join("") === "") continue;
      parsed++;
      const record = {};
      Object.keys(DENTRIX_MAPPING).forEach(function (src) {
        const dest = DENTRIX_MAPPING[src];
        record[dest] = hmap.hasOwnProperty(src) ? row[hmap[src]] : "";
      });
      if (!record.external_patient_id) continue;
      const pk = sha256Hex(practiceId + ":" + record.external_patient_id);
      const existing = pMap[pk];
      const outRow = existing ? existing.slice() : new Array(pHeader.length).fill("");

      function setField(field, val) {
        const idx = pHeader.indexOf(field);
        if (idx !== -1) outRow[idx] = val;
      }

      setField("patient_key", pk);
      Object.keys(record).forEach(function (f) { setField(f, record[f]); });

      const now = nowIso();
      setField("source_last_imported_at", cfg.last_imported_at || now);
      setField("source_last_import_source_file_id", cfg.last_import_source_file_id || "");
      setField("source_last_import_archived_file_id", cfg.last_import_archived_file_id || "");
      setField("updated_at", now);

      ["do_not_text", "complaint_flag"].forEach(function (flag) {
        const idx = pHeader.indexOf(flag);
        if (idx !== -1) {
          const prev = existing ? existing[idx] : "";
          if (String(prev).toUpperCase() === "TRUE") outRow[idx] = true;
        }
      });

      if (existing) { pMap[pk] = outRow; updates++; }
      else { pMap[pk] = outRow; inserts++; }
    }

    const newRows = Object.keys(pMap).map(function (k) { return pMap[k]; });
    patientsSh.clearContents();
    patientsSh.getRange(1, 1, 1, pHeader.length).setValues([pHeader]);
    if (newRows.length) patientsSh.getRange(2, 1, newRows.length, pHeader.length).setValues(newRows);

    logEvent(ss, EVENT_TYPES.IMPORT_PASS, rid, practiceId, "Dentrix import complete", {
      parsed: parsed,
      inserts: inserts,
      updates: updates,
      rows: newRows.length
    });
  } catch (e) {
    logEvent(ss, EVENT_TYPES.IMPORT_FAIL, rid, cfg.practice_id, e.message, {});
    throw e;
  }
}
