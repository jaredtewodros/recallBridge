function onOpen() {
  SpreadsheetApp.getUi().createMenu('RecallBridge')
    .addItem('Preflight','rbPreflight')
    .addItem('Import Latest Dentrix .out','rbImportLatest')
    .addItem('Import Dentrix from Raw','rbImportDentrix')
    .addItem('Refresh Patients','rbRefresh')
    .addItem('Build Queue (T1)','rbQueue')
    .addItem('Dry Run (Import + Refresh + Queue + Invariants)','rbDryRun')
    .addToUi();
}
function rbPreflight(){ RBLib.Preflight(SpreadsheetApp.getActive().getId()); }
function rbImportLatest(){ RBLib.ImportLatestDentrixOut(SpreadsheetApp.getActive().getId()); }
function rbImportDentrix(){ RBLib.ImportDentrixFromRaw(SpreadsheetApp.getActive().getId()); }
function rbRefresh(){ RBLib.RefreshPatients(SpreadsheetApp.getActive().getId()); }
function rbQueue(){ RBLib.BuildQueue(SpreadsheetApp.getActive().getId(), 'T1'); }
function rbDryRun(){ RBLib.DryRunImportRefreshQueue_(SpreadsheetApp.getActive().getId()); }
