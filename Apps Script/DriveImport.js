// DriveImport.js - fetch latest Dentrix .out into Import_Raw

function ImportLatestDentrixOut(practiceSheetId) {
  const rid = runId();
  const ss = SpreadsheetApp.openById(practiceSheetId);
  const cfg = getConfig(ss);
  const practiceId = cfg.practice_id;
  logEvent(ss, EVENT_TYPES.IMPORT_START, rid, practiceId, "ImportLatestDentrixOut", {});
  try {
    const ext = cfg.import_file_extension || "out";
    const q = "'" + cfg.upload_folder_id + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder' and fileExtension='" + ext + "'";
    const res = Drive.Files.list({
      q: q,
      orderBy: "modifiedTime desc",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
      pageSize: 5
    });
    const files = res.items || res.files || [];
    if (!files.length) throw new Error("No source files in upload folder");
    const newest = files[0];

    const ts = Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMdd_HHmmss");
    const copyName = "dentrix_export_" + practiceId + "_" + ts + "." + ext;
    const archived = Drive.Files.copy({ title: copyName, parents: [{ id: cfg.imports_folder_id }] }, newest.id, { supportsAllDrives: true });

    // Use DriveApp to download content (avoids HttpResponseException with alt=media)
    const text = DriveApp.getFileById(newest.id).getBlob().getDataAsString();
    const delimiter = cfg.import_delimiter === "TAB" ? "\t" : (cfg.import_delimiter || "\t");
    let rows = text.split(/\r?\n/).filter(function (r) { return r !== ""; }).map(function (r) { return r.split(delimiter); });
    // Strip surrounding quotes from each cell (Dentrix export wraps fields)
    rows = rows.map(function (row) {
      return row.map(function (cell) {
        if (typeof cell === "string" && cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')) {
          return cell.slice(1, -1).replace(/""/g, '"');
        }
        return cell;
      });
    });
    if (!rows.length) throw new Error("Empty file");
    // Normalize column counts across all rows to avoid range/length mismatch
    const maxCols = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
    rows = rows.map(function (r) {
      if (r.length < maxCols) {
        const padded = r.slice();
        while (padded.length < maxCols) padded.push("");
        return padded;
      }
      return r;
    });

    const rawSh = getSheetByName(ss, "20_Import_Raw");
    rawSh.clearContents();
    rawSh.getRange(1, 1, rows.length, maxCols).setValues(rows);

    setConfig(ss, {
      last_import_source_file_id: newest.id,
      last_import_archived_file_id: archived.id,
      last_imported_at: nowIso()
    });

    logEvent(ss, EVENT_TYPES.IMPORT_PASS, rid, practiceId, "Imported " + rows.length + " rows", {
      source: newest.id,
      archived: archived.id
    });
  } catch (e) {
    logEvent(ss, EVENT_TYPES.IMPORT_FAIL, rid, cfg.practice_id, e.message, {});
    throw e;
  }
}
