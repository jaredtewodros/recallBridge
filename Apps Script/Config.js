// Config.js - read/write config rows

function getConfig(ss) {
  const sh = getSheetByName(ss, "10_Config");
  const values = sh.getDataRange().getValues();
  if (values.length < 2) throw new Error("Config empty");
  const header = values[0];
  if (header[0] !== "key" || header[1] !== "value") {
    throw new Error("Config header must be key,value");
  }
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const k = values[i][0];
    if (k) {
      if (map[k] !== undefined) throw new Error("Duplicate config key: " + k);
      map[k] = values[i][1];
    }
  }
  CONFIG_KEYS.forEach(function (k) {
    if (!(k in map)) throw new Error("Missing config key: " + k);
  });
  return map;
}

function setConfig(ss, kv) {
  const sh = getSheetByName(ss, "10_Config");
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const k = values[i][0];
    if (kv.hasOwnProperty(k)) {
      values[i][1] = kv[k];
    }
  }
  sh.getRange(1, 1, values.length, values[0].length).setValues(values);
}
