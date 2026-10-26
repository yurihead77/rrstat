// Запись одной строки листа metrika_weekly. Чужие листы, формулы и графики не изменяются.

function writeWeeklyRow(row, deps) {
  assertRowPublishable_(row);
  var spreadsheetId = assertSpreadsheetIdAllowed(deps.spreadsheetId);
  var columns = getSheetColumns();
  var line = rowToLine_(row, columns);
  var lock = deps.getLock();
  lock.waitLock(getMetrikaConfig().lockWaitMs);
  try {
    var spreadsheet = deps.openById(spreadsheetId);
    var config = getMetrikaConfig();
    var sheet = spreadsheet.getSheetByName(config.sheetName);
    var createdSheet = false;
    if (!sheet) {
      sheet = spreadsheet.insertSheet(config.sheetName);
      createdSheet = true;
    }
    var width = columns.length;
    var lastRow = sheet.getLastRow();
    if (lastRow === 0) {
      applyRowFormats_(sheet, 2, columns);
      sheet.getRange(1, 1, 2, width).setValues([columns, line]);
      flushWrittenRow_(deps);
      return {
        action: 'append',
        rowNumber: 2,
        sheetName: config.sheetName,
        spreadsheetId: spreadsheetId,
        createdSheet: createdSheet
      };
    }
    var header = sheet.getRange(1, 1, 1, width).getValues()[0];
    if (!headersMatch_(header, columns)) {
      throw new Error(
        'Лист ' + config.sheetName + ' уже существует, но заголовки не совпадают со схемой ' +
        config.definitionVersion + '. Лист не изменён.'
      );
    }
    var target = findTargetRow_(sheet, columns, row, lastRow);
    var formulas = sheet.getRange(target.rowNumber, 1, 1, width).getFormulas()[0];
    if (rowHasFormula_(formulas)) {
      throw new Error('Строка ' + target.rowNumber + ' содержит формулу. Запись остановлена, строка не изменена.');
    }
    applyRowFormats_(sheet, target.rowNumber, columns);
    sheet.getRange(target.rowNumber, 1, 1, width).setValues([line]);
    flushWrittenRow_(deps);
    return {
      action: target.action,
      rowNumber: target.rowNumber,
      sheetName: config.sheetName,
      spreadsheetId: spreadsheetId,
      createdSheet: false
    };
  } finally {
    lock.releaseLock();
  }
}

function flushWrittenRow_(deps) {
  if (!deps || typeof deps.flush !== 'function') {
    throw new Error('Зависимость flush не задана.');
  }
  deps.flush();
}

function assertRowPublishable_(row) {
  if (!row || row.publication !== 'exact') {
    throw new Error('Запись отменена: строка не отмечена как точная.');
  }
  if (row.sampled !== false || row.sample_share !== 1) {
    throw new Error('Запись отменена: семплированный или неполный ответ нельзя публиковать как точный.');
  }
  if (row.timezone !== 'Europe/Moscow') {
    throw new Error('Запись отменена: часовой пояс строки не Europe/Moscow.');
  }
  var key = expectedRowKey_(row);
  if (key.indexOf('||') !== -1 || key.charAt(0) === '|' || key.charAt(key.length - 1) === '|') {
    throw new Error('Запись отменена: ключ строки неполный.');
  }
}

function findTargetRow_(sheet, columns, row, lastRow) {
  var wanted = expectedRowKey_(row);
  if (lastRow < 2) return { action: 'append', rowNumber: 2 };
  var height = lastRow - 1;
  var values = sheet.getRange(2, 1, height, columns.length).getValues();
  var found = [];
  for (var i = 0; i < values.length; i++) {
    if (storedRowKey_(values[i], columns) === wanted) found.push(i + 2);
  }
  if (found.length > 1) {
    throw new Error(
      'На листе metrika_weekly уже есть несколько строк с ключом counter_id + start_date + end_date + ' +
      'definition_version. Запись остановлена, строки не изменены.'
    );
  }
  if (found.length === 1) return { action: 'update', rowNumber: found[0] };
  return { action: 'append', rowNumber: lastRow + 1 };
}

function expectedRowKey_(row) {
  return [
    cellToKeyString_(row.counter_id, 'counter_id'),
    cellToKeyString_(row.start_date, 'start_date'),
    cellToKeyString_(row.end_date, 'end_date'),
    cellToKeyString_(row.definition_version, 'definition_version')
  ].join('|');
}

function storedRowKey_(line, columns) {
  var names = ['counter_id', 'start_date', 'end_date', 'definition_version'];
  var parts = [];
  for (var i = 0; i < names.length; i++) {
    parts.push(cellToKeyString_(line[columns.indexOf(names[i])], names[i]));
  }
  return parts.join('|');
}

function cellToKeyString_(value, columnName) {
  if (value === null || typeof value === 'undefined') return '';
  if ((columnName === 'start_date' || columnName === 'end_date') && isDateValue_(value)) {
    if (isNaN(value.getTime())) return '';
    return formatInstantAsMoscowDate(value);
  }
  return String(value).trim();
}

function isDateValue_(value) {
  return Object.prototype.toString.call(value) === '[object Date]';
}

function headersMatch_(actual, expected) {
  if (!actual || actual.length < expected.length) return false;
  for (var i = 0; i < expected.length; i++) {
    if (String(actual[i] == null ? '' : actual[i]).trim() !== expected[i]) return false;
  }
  return true;
}

function rowHasFormula_(formulas) {
  for (var i = 0; i < formulas.length; i++) {
    if (formulas[i]) return true;
  }
  return false;
}

function rowToLine_(row, columns) {
  var line = [];
  for (var i = 0; i < columns.length; i++) {
    var value = row[columns[i]];
    if (value === null || typeof value === 'undefined') line.push('');
    else line.push(value);
  }
  return line;
}

function applyRowFormats_(sheet, rowNumber, columns) {
  var formats = [];
  for (var i = 0; i < columns.length; i++) formats.push(getColumnFormat(columns[i]));
  sheet.getRange(rowNumber, 1, 1, columns.length).setNumberFormats([formats]);
}
