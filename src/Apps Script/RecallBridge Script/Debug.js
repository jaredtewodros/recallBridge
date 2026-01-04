// Debug.js - small helpers

function DebugPrintServiceUrl() {
  const url = ScriptApp.getService().getUrl();
  Logger.log(url || "(no web app URL; deploy as Web App to get one)");
  return url;
}

// Inspect current service URL vs normalized /exec and the discovered exec URL (cached + live).
function DebugInspectExecUrls() {
  const serviceUrl = ScriptApp.getService().getUrl() || "";
  const execUrl = serviceUrl ? serviceUrl.replace(/\/dev$/, "/exec") : "";
  const cachedExec = typeof getCachedWebAppExecUrl_ === "function" ? getCachedWebAppExecUrl_() : "";
  let discoveredExec = "";
  try { discoveredExec = typeof getCurrentWebAppExecUrl_ === "function" ? getCurrentWebAppExecUrl_() : ""; } catch (_e) {}
  const legacyPropUrl = PropertiesService.getScriptProperties().getProperty("RB_WEBHOOK_BASE_URL") || "";
  const details = {
    service_url: serviceUrl,
    normalized_exec_url: execUrl,
    cached_exec_url: cachedExec,
    discovered_exec_url: discoveredExec,
    legacy_script_prop_base: legacyPropUrl
  };
  Logger.log(details);
  return details;
}

// Refresh cached exec URL from Apps Script API; avoids relying on manual RB_WEBHOOK_BASE_URL.
function DebugSetWebhookBaseFromService() {
  try { if (typeof invalidateWebAppExecUrlCache_ === "function") invalidateWebAppExecUrlCache_(); } catch (_e) {}
  const execUrl = typeof getCurrentWebAppExecUrl_ === "function" ? getCurrentWebAppExecUrl_() : "";
  const out = { refreshed_exec_url: execUrl };
  Logger.log(out);
  return out;
}
