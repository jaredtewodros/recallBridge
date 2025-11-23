function setupQueueFormatting() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName('Queue') || ss.insertSheet('Queue');

  // Freeze header
  sheet.setFrozenRows(1);

  // Ensure at least A:J exist
  if (sheet.getMaxColumns() < 10) sheet.insertColumnsAfter(sheet.getMaxColumns(), 10 - sheet.getMaxColumns());

  // Data validation (I = status)
  const maxRows = Math.max(sheet.getMaxRows(), 1000);
  const statusRange = sheet.getRange(2, 9, maxRows - 1, 1);
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['new','calling','lvm','texted','booked','closed','dnd','wrong_number'], true)
    .setAllowInvalid(false)
    .build();
  statusRange.setDataValidation(statusRule);

  // Timestamp formats (E, G, H)
  sheet.getRange(2, 5, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(2, 7, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(2, 8, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  // Clear CF then apply rules to A2:J
  sheet.setConditionalFormatRules([]);
  const dataRange = sheet.getRange(2, 1, maxRows - 1, 10);
  const rules = [];

  // Due now (yellow): next_action_at <= NOW(), not booked/closed
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(NOT(ISBLANK($H2)),$H2<=NOW(),NOT(REGEXMATCH($I2,"booked|closed")))')
      .setBackground('#FFF4CE')
      .setRanges([dataRange])
      .build()
  );

  // Overdue after reply (>60min) (red)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(NOT(ISBLANK($E2)),NOW()-$E2>60/1440,OR($G2="",$G2<$E2),NOT(REGEXMATCH($I2,"booked|closed")))')
      .setBackground('#FDE7E9')
      .setRanges([dataRange])
      .build()
  );

  // Stale lead: agent_attempts >=3 (orange)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(VALUE($F2)>=3,NOT(REGEXMATCH($I2,"booked|closed")))')
      .setBackground('#FDECC8')
      .setRanges([dataRange])
      .build()
  );

  // DND / wrong number (gray)
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=REGEXMATCH($I2,"dnd|wrong_number")')
      .setBackground('#E5E5E5')
      .setRanges([dataRange])
      .build()
  );

  // Hot reply: responded in last 15 min (green) — LAST so it wins
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(NOT(ISBLANK($E2)),NOW()-$E2<=15/1440,NOT(REGEXMATCH($I2,"booked|closed")))')
      .setBackground('#D1FADF')
      .setRanges([dataRange])
      .build()
  );

  sheet.setConditionalFormatRules(rules);
}

function rehydrateQueueFormulas() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Queue');
  if (!sh) return;

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const cols = { responded_at: 5, last_action_at: 7, next_action_at: 8 }; // E,G,H
  const range = sh.getRange(2, 1, lastRow - 1, 10).getValues();

  for (let r = 0; r < range.length; r++) {
    // E/G/H only: if cell starts with '=' as text, re-set as formula
    [['responded_at', cols.responded_at], ['last_action_at', cols.last_action_at], ['next_action_at', cols.next_action_at]].forEach(([_, c]) => {
      const cell = sh.getRange(r + 2, c);
      const val = cell.getValue();
      if (typeof val === 'string' && val.trim().startsWith('=')) {
        cell.setFormula(val.trim());
      }
    });
  }
}

