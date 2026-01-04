// Menu.js - adds RecallBridge menu

function onOpen() {
  SpreadsheetApp.getUi().createMenu("RecallBridge")
    .addItem("Preflight", "menuPreflight")
    .addItem("Import Latest Dentrix .out", "menuImportLatest")
    .addItem("Import Dentrix from Raw", "menuImportDentrix")
    .addItem("Refresh Patients", "menuRefresh")
    .addItem("Build Queue (T1)", "menuQueue")
    .addItem("Dry Run (Import + Refresh + Queue + Invariants)", "menuDryRun")
    .addItem("Create Touches from Queue (DRY_RUN)", "menuCreateTouches")
    .addItem("Send Ready Touches (DRY_RUN)", "menuSendTouches")
    .addToUi();
}

function menuPreflight() { Preflight(SpreadsheetApp.getActive().getId()); }
function menuImportLatest() { ImportLatestDentrixOut(SpreadsheetApp.getActive().getId()); }
function menuImportDentrix() { ImportDentrixFromRaw(SpreadsheetApp.getActive().getId()); }
function menuRefresh() { RefreshPatients(SpreadsheetApp.getActive().getId()); }
function menuQueue() { BuildQueue(SpreadsheetApp.getActive().getId(), "T1"); }
function menuDryRun() { DryRunImportRefreshQueue(SpreadsheetApp.getActive().getId()); }
function menuCreateTouches() {
  const ss = SpreadsheetApp.getActive();
  const cfg = getConfig(ss);
  const ui = SpreadsheetApp.getUi();
  const touchPrompt = ui.prompt("Touch Type", "Enter touch type (e.g., T1):", ui.ButtonSet.OK_CANCEL);
  if (touchPrompt.getSelectedButton() !== ui.Button.OK) return;
  const touch = touchPrompt.getResponseText() || "T1";
  const campaignPrompt = ui.prompt("Campaign ID", "Enter campaign_id (default from Config):", ui.ButtonSet.OK_CANCEL);
  if (campaignPrompt.getSelectedButton() !== ui.Button.OK) return;
  const campaign = campaignPrompt.getResponseText() || cfg.active_campaign_id || "";
  if (!campaign) throw new Error("Set active_campaign_id in Config or enter a campaign_id.");
  CreateTouchesFromQueue(ss.getId(), touch, campaign, true);
}
function menuSendTouches() {
  const ss = SpreadsheetApp.getActive();
  const cfg = getConfig(ss);
  const ui = SpreadsheetApp.getUi();
  const touchPrompt = ui.prompt("Touch Type", "Enter touch type (e.g., T1):", ui.ButtonSet.OK_CANCEL);
  if (touchPrompt.getSelectedButton() !== ui.Button.OK) return;
  const touch = touchPrompt.getResponseText() || "T1";
  const campaign = cfg.active_campaign_id || "";
  if (!campaign) throw new Error("Set active_campaign_id in Config before sending.");
  SendReadyTouches(ss.getId(), touch, true);
}
