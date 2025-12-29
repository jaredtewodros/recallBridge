// DeploymentUrl.js - programmatic Web App exec URL discovery via Apps Script API

var WEBAPP_EXEC_CACHE_KEY = "rb_webapp_exec_url_v1";
var WEBAPP_EXEC_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours

function getCurrentWebAppExecUrl_() {
  var cached = getCachedWebAppExecUrl_();
  if (cached) return cached;
  var url = "";
  try {
    var deployments = fetchDeployments_();
    var candidate = selectBestWebAppDeploymentCandidate_(deployments);
    url = candidate && candidate.url ? candidate.url : "";
  } catch (err) {
    // Fallback to the service URL if API call is not authorized; log for visibility.
    try { Logger.log({ deployments_list_error: String(err) }); } catch (_e) {}
    var svc = ScriptApp.getService().getUrl() || "";
    if (svc) url = svc.replace(/\/dev$/, "/exec");
  }
  if (url) CacheService.getScriptCache().put(WEBAPP_EXEC_CACHE_KEY, url, WEBAPP_EXEC_CACHE_TTL_SECONDS);
  return url;
}

function getCachedWebAppExecUrl_() {
  return CacheService.getScriptCache().get(WEBAPP_EXEC_CACHE_KEY) || "";
}

function fetchDeployments_() {
  var scriptId = ScriptApp.getScriptId();
  if (!scriptId) throw new Error("Script ID not found; ensure the project is saved and linked.");
  // Prefer advanced service Script.Deployments.list when available (auto-manages scopes when enabled).
  if (typeof Script !== "undefined" && Script.Deployments && typeof Script.Deployments.list === "function") {
    try {
      var listResp = Script.Deployments.list(scriptId, { pageSize: 50 });
      return listResp && listResp.deployments ? listResp.deployments : [];
    } catch (_err) {
      // Fall through to UrlFetch if advanced service fails or not enabled.
    }
  }
  var resp = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + encodeURIComponent(scriptId) + "/deployments?pageSize=50", {
    method: "get",
    muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText() || "";
  if (code < 200 || code >= 300) {
    // Add a clearer hint for missing scopes / disabled API without assuming the root cause.
    var hint = "";
    if (code === 401 || code === 403) {
      hint = " (enable Apps Script API advanced service in the editor and authorize; the call needs deployments.readonly scope)";
    }
    throw new Error("deployments.list failed with " + code + ": " + body + hint);
  }
  try {
    var parsed = JSON.parse(body);
    return parsed.deployments || [];
  } catch (err) {
    throw new Error("deployments.list JSON parse error: " + err.message);
  }
}

function selectBestWebAppDeployment_(deployments) {
  var candidate = selectBestWebAppDeploymentCandidate_(deployments);
  return candidate ? candidate.url : "";
}

function selectBestWebAppDeploymentCandidate_(deployments) {
  if (!deployments || !deployments.length) return null;
  var candidates = rankWebAppDeploymentCandidates_(deployments);
  return candidates.length ? candidates[0] : null;
}

function rankWebAppDeploymentCandidates_(deployments) {
  var list = [];
  (deployments || []).forEach(function (d) {
    var entryPoints = d.entryPoints || [];
    entryPoints.forEach(function (ep) {
      if (ep.entryPointType !== "WEB_APP") return;
      var url = ep.webApp && ep.webApp.url;
      if (!url) return;
      var access = (ep.webApp.entryPointConfig && ep.webApp.entryPointConfig.access) || "";
      var accessPriority = access === "ANYONE_ANONYMOUS" ? 0 : (access === "ANYONE" ? 1 : 2);
      list.push({
        deploymentId: d.deploymentId,
        updateTime: d.updateTime || "",
        description: (d.deploymentConfig && d.deploymentConfig.description) || "",
        access: access,
        accessPriority: accessPriority,
        url: url
      });
    });
  });
  list.sort(function (a, b) {
    if (a.accessPriority !== b.accessPriority) return a.accessPriority - b.accessPriority;
    var aTime = a.updateTime ? new Date(a.updateTime).getTime() : 0;
    var bTime = b.updateTime ? new Date(b.updateTime).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime; // newer first
    var aProd = /prod(uction)?/i.test(a.description || "");
    var bProd = /prod(uction)?/i.test(b.description || "");
    if (aProd !== bProd) return bProd ? -1 : 1;
    if (a.deploymentId !== b.deploymentId) return a.deploymentId < b.deploymentId ? -1 : 1;
    return 0;
  });
  return list;
}

function invalidateWebAppExecUrlCache_() {
  CacheService.getScriptCache().remove(WEBAPP_EXEC_CACHE_KEY);
}

// ===== Admin / tests =====

function rbDebug_LogExecUrl() {
  var deployments = fetchDeployments_();
  var ranked = rankWebAppDeploymentCandidates_(deployments);
  var top = ranked.length ? ranked[0] : null;
  var out = top ? {
    deployment_id: top.deploymentId,
    update_time: top.updateTime,
    access: top.access,
    url: top.url
  } : { error: "No WEB_APP deployments found." };
  Logger.log(out);
  if (top && top.url) CacheService.getScriptCache().put(WEBAPP_EXEC_CACHE_KEY, top.url, WEBAPP_EXEC_CACHE_TTL_SECONDS);
  return top ? top.url : "";
}

function test_getCurrentWebAppExecUrl_returnsExec() {
  var url = getCurrentWebAppExecUrl_();
  if (!url || url.indexOf("/exec") === -1) throw new Error("Expected exec URL, got: " + url);
  Logger.log({ exec_url: url });
  return url;
}

function test_selectBestDeployment_prefersAnonymous() {
  var deployments = [
    {
      deploymentId: "recent-anyone",
      updateTime: "2025-02-01T00:00:00Z",
      deploymentConfig: { description: "prod" },
      entryPoints: [
        { entryPointType: "WEB_APP", webApp: { url: "https://example.com/anyone/exec", entryPointConfig: { access: "ANYONE" } } }
      ]
    },
    {
      deploymentId: "older-anon",
      updateTime: "2025-01-15T00:00:00Z",
      deploymentConfig: { description: "prod" },
      entryPoints: [
        { entryPointType: "WEB_APP", webApp: { url: "https://example.com/anon/exec", entryPointConfig: { access: "ANYONE_ANONYMOUS" } } }
      ]
    }
  ];
  var selected = selectBestWebAppDeployment_(deployments);
  if (selected !== "https://example.com/anon/exec") throw new Error("Expected ANYONE_ANONYMOUS selection, got " + selected);
  Logger.log({ selected: selected });
  return selected;
}
