// Menu.js - adds RecallBridge menu

function onOpen() {
  SpreadsheetApp.getUi().createMenu("RecallBridge")
    .addItem("Preflight", "menuPreflight")
    .addItem("Import Latest Dentrix .out", "menuImportLatest")
    .addItem("Import Dentrix from Raw", "menuImportDentrix")
    .addItem("Refresh Patients", "menuRefresh")
    .addItem("Build Queue (T1)", "menuQueue")
    .addItem("Dry Run (Import + Refresh + Queue + Invariants)", "menuDryRun")
    .addToUi();
}

function menuPreflight() { Preflight(SpreadsheetApp.getActive().getId()); }
function menuImportLatest() { ImportLatestDentrixOut(SpreadsheetApp.getActive().getId()); }
function menuImportDentrix() { ImportDentrixFromRaw(SpreadsheetApp.getActive().getId()); }
function menuRefresh() { RefreshPatients(SpreadsheetApp.getActive().getId()); }
function menuQueue() { BuildQueue(SpreadsheetApp.getActive().getId(), "T1"); }
function menuDryRun() { DryRunImportRefreshQueue_(SpreadsheetApp.getActive().getId()); }
