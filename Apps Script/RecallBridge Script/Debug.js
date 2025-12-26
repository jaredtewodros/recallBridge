// Debug.js - small helpers

function DebugPrintServiceUrl() {
  const url = ScriptApp.getService().getUrl();
  Logger.log(url || "(no web app URL; deploy as Web App to get one)");
  return url;
}
