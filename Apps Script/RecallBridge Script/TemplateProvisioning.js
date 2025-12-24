// TemplateProvisioning.js - template creation and practice provisioning

function CreateVersionedTemplateV1() {
  const rid = runId();
  let ss = null;
  try {
    const name = TEMPLATE_NAME_PREFIX + Utilities.formatDate(new Date(), "Etc/UTC", "yyyyMMdd_HHmmss");
    ss = SpreadsheetApp.create(name);

    // Ensure required sheets exist and remove extras
    const existing = ss.getSheets().map(function (s) { return s.getName(); });
    REQUIRED_SHEETS.forEach(function (n) {
      if (existing.indexOf(n) === -1) ss.insertSheet(n);
    });
    ss.getSheets().forEach(function (s) {
      if (REQUIRED_SHEETS.indexOf(s.getName()) === -1) ss.deleteSheet(s);
    });

    // 00_README
    const readme = ss.getSheetByName("00_README");
    readme.clear();
    readme.getRange(1,1,7,1).setValues([
      ["RecallBridge Template v1"],
      ["Operator rules:"],
      ["- Only edit 10_Config."],
      ["- In 30_Patients, only do_not_text and complaint_flag may be edited manually."],
      ["- Do not edit 50_Queue (overwritten)."],
      ["- Do not edit 60_Touches (append-only)."],
      ["- Do not reorder/rename headers (Preflight enforces)."]
    ]);
    readme.setFrozenRows(1);

    // 10_Config
    const cfg = ss.getSheetByName("10_Config");
    cfg.clear();
    cfg.appendRow(["key", "value"]);
    CONFIG_KEYS.forEach(function (k) { cfg.appendRow([k, ""]); });
    cfg.setFrozenRows(1);
    cfg.getRange(1,1,1,cfg.getLastColumn()).setFontWeight("bold");

    // 20_Import_Raw placeholder header (overwritten on import)
    const raw = ss.getSheetByName("20_Import_Raw");
    raw.clear();
    raw.appendRow(["placeholder"]);
    raw.setFrozenRows(1);
    raw.getRange(1,1,1,raw.getLastColumn()).setFontWeight("bold");

    // 30_Patients
    const p = ss.getSheetByName("30_Patients");
    p.clear();
    p.appendRow(PATIENT_HEADERS);
    p.setFrozenRows(1);
    p.getRange(1,1,1,p.getLastColumn()).setFontWeight("bold");

    // 50_Queue
    const q = ss.getSheetByName("50_Queue");
    q.clear();
    q.appendRow(QUEUE_HEADERS);
    q.setFrozenRows(1);
    q.getRange(1,1,1,q.getLastColumn()).setFontWeight("bold");

    // 60_Touches
    const t = ss.getSheetByName("60_Touches") || ss.insertSheet("60_Touches");
    t.clear();
    t.appendRow(TOUCHES_HEADERS);
    t.setFrozenRows(1);
    t.getRange(1,1,1,t.getLastColumn()).setFontWeight("bold");

    // 70_EventLog
    const ev = ss.getSheetByName("70_EventLog");
    ev.clear();
    ev.appendRow(EVENT_HEADERS);
    ev.setFrozenRows(1);
    ev.getRange(1,1,1,ev.getLastColumn()).setFontWeight("bold");

    // Protect header rows; only data rows remain editable
    [cfg, raw, p, q, ev, t].forEach(function (sh) {
      const prot = sh.protect().setDescription(sh.getName() + " header");
      const unprot = sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns());
      prot.setUnprotectedRanges([unprot]);
      prot.removeEditors(prot.getEditors());
      if (prot.canDomainEdit()) prot.setDomainEdit(false);
    });

    // Data validation for mode/kill_switch
    const modeRule = SpreadsheetApp.newDataValidation().requireValueInList(["DRY_RUN", "LIVE"], true).build();
    const killRule = SpreadsheetApp.newDataValidation().requireValueInList(["ON", "OFF"], true).build();
    const cfgValues = cfg.getDataRange().getValues();
    for (let i = 1; i < cfgValues.length; i++) {
      if (cfgValues[i][0] === "mode") cfg.getRange(i + 1, 2).setDataValidation(modeRule).setValue("DRY_RUN");
      if (cfgValues[i][0] === "kill_switch") cfg.getRange(i + 1, 2).setDataValidation(killRule).setValue("OFF");
      if (cfgValues[i][0] === "timezone") cfg.getRange(i + 1, 2).setValue("America/New_York");
      if (cfgValues[i][0] === "import_delimiter") cfg.getRange(i + 1, 2).setValue("TAB");
      if (cfgValues[i][0] === "import_file_extension") cfg.getRange(i + 1, 2).setValue("out");
      if (cfgValues[i][0] === "patient_key_strategy") cfg.getRange(i + 1, 2).setValue("SHA256(practice_id:external_patient_id)");
      if (cfgValues[i][0] === "recall_due_window_days") cfg.getRange(i + 1, 2).setValue(30);
      if (cfgValues[i][0] === "invariant_min_sms_contact_rate") cfg.getRange(i + 1, 2).setValue(0.30);
      if (cfgValues[i][0] === "invariant_max_invalid_recall_date_rate") cfg.getRange(i + 1, 2).setValue(0.10);
      if (cfgValues[i][0] === "invariant_allow_zero_eligible") cfg.getRange(i + 1, 2).setValue(false);
      if (cfgValues[i][0] === "invariant_queue_mode") cfg.getRange(i + 1, 2).setValue("ALL_PATIENTS");
      if (cfgValues[i][0] === "active_campaign_id") cfg.getRange(i + 1, 2).setValue("");
      if (cfgValues[i][0] === "touches_dry_run_default") cfg.getRange(i + 1, 2).setValue(true);
      if (cfgValues[i][0] === "send_rate_limit_per_minute") cfg.getRange(i + 1, 2).setValue(60);
    }

    // Move template into Templates folder via DriveApp (shared-drive safe)
    const tmplFile = DriveApp.getFileById(ss.getId());
    const targetFolder = DriveApp.getFolderById(PRODUCT_TEMPLATES_FOLDER_ID);
    targetFolder.addFile(tmplFile);
    const parents = tmplFile.getParents();
    while (parents.hasNext()) {
      const parent = parents.next();
      if (parent.getId() !== PRODUCT_TEMPLATES_FOLDER_ID) parent.removeFile(tmplFile);
    }

    PropertiesService.getScriptProperties().setProperty(SCRIPT_PROP_LATEST_TEMPLATE_ID, ss.getId());
    logEvent(ss, EVENT_TYPES.TEMPLATE_CREATE_PASS, rid, "", "Template created", { templateId: ss.getId(), name: ss.getName() });
    return ss.getId();
  } catch (e) {
    if (ss) logEvent(ss, EVENT_TYPES.TEMPLATE_CREATE_FAIL, rid, "", e.message, {});
    throw e;
  }
}

function ProvisionPracticeEngineFromLatestTemplate(practice_id, practice_display_name, work_folder_id, upload_folder_id, imports_folder_id, timezone) {
  const rid = runId();
  const templateId = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROP_LATEST_TEMPLATE_ID);
  if (!templateId) throw new Error("LATEST_TEMPLATE_ID missing; run CreateVersionedTemplateV1 first.");
  if (!practice_id) throw new Error("practice_id is required");
  if (!practice_display_name) practice_display_name = practice_id;
  if (!work_folder_id) throw new Error("work_folder_id is required");
  if (!upload_folder_id) throw new Error("upload_folder_id is required");
  if (!imports_folder_id) throw new Error("imports_folder_id is required");
  try {
    const copyName = ENGINE_NAME_PREFIX + practice_display_name + ENGINE_NAME_SUFFIX;
    // Copy directly into the work folder via DriveApp (shared-drive safe, single parent)
    const templateFile = DriveApp.getFileById(templateId);
    const workFolder = DriveApp.getFolderById(work_folder_id);
    const copy = templateFile.makeCopy(copyName, workFolder);

    const ss = SpreadsheetApp.openById(copy.getId());
    setConfig(ss, {
      practice_id: practice_id,
      practice_display_name: practice_display_name,
      timezone: timezone || "America/New_York",
      practice_sheet_id: copy.getId(),
      upload_folder_id: upload_folder_id,
      imports_folder_id: imports_folder_id,
      import_delimiter: "TAB",
      import_file_extension: "out",
      patient_key_strategy: "SHA256(practice_id:external_patient_id)",
      recall_due_window_days: 30,
      invariant_min_sms_contact_rate: 0.30,
      invariant_max_invalid_recall_date_rate: 0.10,
      invariant_allow_zero_eligible: false,
      invariant_queue_mode: "ALL_PATIENTS",
      active_campaign_id: "",
      touches_dry_run_default: true,
      send_rate_limit_per_minute: 60,
      mode: "DRY_RUN",
      kill_switch: "OFF"
    });
    logEvent(ss, EVENT_TYPES.PROVISION_PASS, rid, practice_id, "Provisioned engine", { engineId: copy.getId(), url: ss.getUrl() });
    return ss.getUrl();
  } catch (e) {
    const ss = SpreadsheetApp.openById(templateId);
    logEvent(ss, EVENT_TYPES.PROVISION_FAIL, rid, practice_id, e.message, {});
    throw e;
  }
}

// Temporary wrapper for DKC (remove when not needed)
function ProvisionDKC() {
  return ProvisionPracticeEngineFromLatestTemplate(
    "dkc",
    "DKC",
    DKC_WORK_FOLDER_ID,
    DKC_UPLOAD_FOLDER_ID,
    DKC_IMPORTS_FOLDER_ID,
    "America/New_York"
  );
}
