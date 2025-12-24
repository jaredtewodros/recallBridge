function onOpen() {
  SpreadsheetApp.getUi().createMenu('RecallBridge')
    .addItem('Preflight','rbPreflight')
    .addItem('Import Latest Dentrix .out','rbImportLatest')
    .addItem('Import Dentrix from Raw','rbImportDentrix')
    .addItem('Refresh Patients','rbRefresh')
    .addItem('Build Queue (T1)','rbQueue')
    .addItem('Dry Run (Import + Refresh + Queue + Invariants)','rbDryRun')
    .addItem('Create Touches from Queue (DRY_RUN)','rbCreateTouches')
    .addItem('Send Ready Touches (DRY_RUN)','rbSendTouches')
    .addToUi();
}
function rbPreflight(){ RBLib.Preflight(SpreadsheetApp.getActive().getId()); }
function rbImportLatest(){ RBLib.ImportLatestDentrixOut(SpreadsheetApp.getActive().getId()); }
function rbImportDentrix(){ RBLib.ImportDentrixFromRaw(SpreadsheetApp.getActive().getId()); }
function rbRefresh(){ RBLib.RefreshPatients(SpreadsheetApp.getActive().getId()); }
function rbQueue(){ RBLib.BuildQueue(SpreadsheetApp.getActive().getId(), 'T1'); }
function rbDryRun(){ RBLib.DryRunImportRefreshQueue(SpreadsheetApp.getActive().getId()); }
function rbCreateTouches() {
  const ss = SpreadsheetApp.getActive();
  const cfg = RBLib.getConfig(ss);
  const ui = SpreadsheetApp.getUi();
  const touchPrompt = ui.prompt("Touch Type", "Enter touch type (e.g., T1):", ui.ButtonSet.OK_CANCEL);
  if (touchPrompt.getSelectedButton() !== ui.Button.OK) return;
  const touch = touchPrompt.getResponseText() || "T1";
  const campaignPrompt = ui.prompt("Campaign ID", "Enter campaign_id (default from Config):", ui.ButtonSet.OK_CANCEL);
  if (campaignPrompt.getSelectedButton() !== ui.Button.OK) return;
  const campaign = campaignPrompt.getResponseText() || cfg.active_campaign_id || "";
  if (!campaign) throw new Error("Set active_campaign_id in Config or enter a campaign_id.");
  RBLib.CreateTouchesFromQueue(ss.getId(), touch, campaign, true);
}
function rbSendTouches() {
  const ss = SpreadsheetApp.getActive();
  const cfg = RBLib.getConfig(ss);
  const ui = SpreadsheetApp.getUi();
  const touchPrompt = ui.prompt("Touch Type", "Enter touch type (e.g., T1):", ui.ButtonSet.OK_CANCEL);
  if (touchPrompt.getSelectedButton() !== ui.Button.OK) return;
  const touch = touchPrompt.getResponseText() || "T1";
  const campaign = cfg.active_campaign_id || "";
  if (!campaign) throw new Error("Set active_campaign_id in Config before sending.");
  RBLib.SendReadyTouches(ss.getId(), touch, true);
}
