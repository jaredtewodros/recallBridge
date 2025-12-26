// Templates.js - message rendering ported from templates.py

var OPT_OUT_FOOTER = " Reply STOP to opt out.";

function normListTag_(tag) {
  if (!tag) return "due_soon";
  var t = String(tag).trim().toLowerCase();
  return t === "past_due" ? "past_due" : "due_soon";
}

function greeting_(first) {
  first = (first || "").trim();
  return first ? first : "there";
}

function renderLinkMode(opts) {
  var tag = normListTag_(opts.list_tag);
  var name = greeting_(opts.first);
  var touch = (opts.touch || "t1").trim().toLowerCase();
  var shortUrl = opts.short_url || "";
  var officePhone = opts.office_phone || "";
  var practiceName = opts.practice_name || "your practice";
  var includeOptOut = opts.include_opt_out !== false;

  if (!shortUrl) throw new Error("short_url is required for link mode");

  var body;
  if (touch === "t2") {
    var lead = tag === "past_due" ? "following up on your overdue recall/cleaning." : "checking back about your hygiene/recall visit.";
    body = "Hi " + name + ", this is " + practiceName + ", " + lead + " We still have openings this week. Book here: " + shortUrl + "\n\nQuestions? Call " + officePhone + ".";
  } else {
    if (tag === "past_due") {
      body = "Hi " + name + ", this is " + practiceName + ". Your recall/cleaning is past due. Book here: " + shortUrl + "\n\nQuestions? Call " + officePhone + ".";
    } else {
      body = "Hi " + name + ", this is " + practiceName + ". You’re due for your next hygiene/recall visit. Book here: " + shortUrl + "\n\nQuestions? Call " + officePhone + ".";
    }
  }

  if (includeOptOut) body += OPT_OUT_FOOTER;
  return body;
}

function renderManualMode(opts) {
  var tag = normListTag_(opts.list_tag);
  var name = greeting_(opts.first);
  var touch = (opts.touch || "t1").trim().toLowerCase();
  var officePhone = opts.office_phone || "";
  var practiceName = opts.practice_name || "your practice";
  var includeOptOut = opts.include_opt_out !== false;

  var lead;
  if (touch === "t2") {
    lead = "Following up about your hygiene/recall visit.";
  } else {
    lead = tag === "past_due" ? "Your recall/cleaning is past due." : "You’re due for your next hygiene/recall visit.";
  }

  var body = "Hi " + name + ", this is " + practiceName + ". " + lead + " Reply YES and we’ll call to schedule. Prefer a call now? Text CALL ME.\n\nQuestions? Call " + officePhone + ".";
  if (includeOptOut) body += OPT_OUT_FOOTER;
  return body;
}

function renderMessage(opts) {
  var mode = (opts.mode || "link").trim().toLowerCase();
  if (mode === "manual") {
    return renderManualMode(opts);
  }
  // default link mode
  return renderLinkMode(opts);
}
