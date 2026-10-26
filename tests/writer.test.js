const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadGas, buildPayload, expectedRequest, NOW, SHEET_ID, columnIndex,
  createMemorySpreadsheet, createRuntime, sheetSnapshot
} = require('./helpers');

function otherSheet() {
  return { name: 'Лист1', rows: [['заголовок'], [2]], formulas: [[''], ['=1+1']] };
}

function exactRow(gas, mutate) {
  const result = gas.interpretMetrikaResponse(buildPayload(gas, mutate), expectedRequest(gas, NOW));
  assert.equal(result.exact, true);
  return result.row;
}

function writeDeps(runtime, spreadsheetId) {
  return {
    spreadsheetId: spreadsheetId || SHEET_ID,
    openById: runtime.deps.openById,
    getLock: runtime.deps.getLock,
    flush: function() { return runtime.deps.flush(); }
  };
}

function instrumentSetValues(sheet, order) {
  if (sheet._setValuesInstrumented) return;
  sheet._setValuesInstrumented = true;
  const originalGetRange = sheet.getRange;
  sheet.getRange = function() {
    const range = originalGetRange.apply(sheet, arguments);
    const originalSetValues = range.setValues;
    range.setValues = function(values) {
      order.push('setValues');
      return originalSetValues.call(range, values);
    };
    return range;
  };
}

test('создание листа пишет числа, доли и пустой visits_per_user при нулевых пользователях', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const spreadsheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const before = sheetSnapshot(spreadsheet.getSheetByName('Лист1'));
  const runtime = createRuntime({ spreadsheet: spreadsheet });
  const row = exactRow(gas);
  const written = gas.writeWeeklyRow(row, writeDeps(runtime));
  assert.equal(written.action, 'append');
  assert.equal(written.rowNumber, 2);
  assert.equal(spreadsheet._insertCount, 1);
  const sheet = spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(sheet._setCalls.length, 1);
  assert.equal(sheet._setCalls[0].row, 1);
  assert.equal(sheet._setCalls[0].values.length, 2);
  const columns = gas.getSheetColumns();
  assert.deepEqual(Array.from(sheet._rows[0]), Array.from(columns));
  const data = sheet._rows[1];
  assert.equal(data[columnIndex(gas, 'counter_id')], 176199);
  assert.equal(data[columnIndex(gas, 'start_date')], '2026-10-12');
  assert.equal(data[columnIndex(gas, 'visits')], ref.visits);
  assert.equal(typeof data[columnIndex(gas, 'visits')], 'number');
  assert.equal(data[columnIndex(gas, 'bounce_rate')], ref.bounceRate);
  assert.ok(data[columnIndex(gas, 'bounce_rate')] < 1);
  assert.equal(data[columnIndex(gas, 'percent_new_visitors')], ref.newVisitorsShare);
  assert.equal(data[columnIndex(gas, 'avg_visit_duration_seconds')], 86.4);
  assert.equal(data[columnIndex(gas, 'visits_per_user')], ref.visitsPerUser);
  assert.equal(data[columnIndex(gas, 'sampled')], false);
  assert.equal(data[columnIndex(gas, 'data_lag_seconds')], 0);
  assert.equal(data[columnIndex(gas, 'publication')], 'exact');
  const formats = sheet._formats[0].formatGrid[0];
  assert.equal(formats[columnIndex(gas, 'start_date')], '@');
  assert.equal(formats[columnIndex(gas, 'bounce_rate')], '0.0000%');
  assert.equal(formats[columnIndex(gas, 'avg_visit_duration_seconds')], '0.00');
  assert.equal(sheetSnapshot(spreadsheet.getSheetByName('Лист1')), before);
  assert.equal(runtime.lockState.releases, 1);
  assert.equal(runtime.lockState.held, false);
  assert.equal(runtime.lockState.waitMs, 20000);

  const zeros = exactRow(gas, function(body) {
    body.totals = body.query.metrics.map(function() { return 0; });
    body.data[0].metrics = body.totals.slice();
  });
  const zeroSheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const zeroRuntime = createRuntime({ spreadsheet: zeroSheet });
  gas.writeWeeklyRow(zeros, writeDeps(zeroRuntime));
  const zeroRow = zeroSheet.getSheetByName('metrika_weekly')._rows[1];
  assert.equal(zeroRow[columnIndex(gas, 'users')], 0);
  assert.equal(zeroRow[columnIndex(gas, 'visits')], 0);
  assert.equal(zeroRow[columnIndex(gas, 'visits_per_user')], '');
});

test('повторный импорт обновляет строку того же ключа и не задевает другую версию', function() {
  const gas = loadGas();
  const spreadsheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const before = sheetSnapshot(spreadsheet.getSheetByName('Лист1'));
  const runtime = createRuntime({ spreadsheet: spreadsheet });
  const row = exactRow(gas);
  gas.writeWeeklyRow(row, writeDeps(runtime));
  const updated = exactRow(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 10;
    body.data[0].metrics = body.totals.slice();
  });
  updated.fetched_at = '2026-10-25T12:00:01.000+03:00';
  const second = gas.writeWeeklyRow(updated, writeDeps(runtime));
  assert.equal(second.action, 'update');
  assert.equal(second.rowNumber, 2);
  const sheet = spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], 10);
  assert.equal(sheet._rows[0][0], 'counter_id');
  assert.equal(sheet._setCalls.length, 2);
  assert.equal(sheet._setCalls[1].row, 2);
  assert.equal(sheet._setCalls[1].values.length, 1);

  const otherVersion = JSON.parse(JSON.stringify(row));
  otherVersion.definition_version = 'metrika_weekly_v2';
  otherVersion.fetched_at = '2026-10-25T12:00:02.000+03:00';
  const third = gas.writeWeeklyRow(otherVersion, writeDeps(runtime));
  assert.equal(third.action, 'append');
  assert.equal(sheet.getLastRow(), 3);
  assert.equal(sheet._rows[2][columnIndex(gas, 'definition_version')], 'metrika_weekly_v2');
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], 10);
  assert.equal(sheetSnapshot(spreadsheet.getSheetByName('Лист1')), before);
});

test('дата в ячейке Москвы находится как тот же ключ', function() {
  const gas = loadGas();
  const spreadsheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const runtime = createRuntime({ spreadsheet: spreadsheet });
  const row = exactRow(gas);
  gas.writeWeeklyRow(row, writeDeps(runtime));
  const sheet = spreadsheet.getSheetByName('metrika_weekly');
  sheet._rows[1][columnIndex(gas, 'start_date')] = new Date(Date.UTC(2026, 9, 11, 21, 0, 0));
  sheet._rows[1][columnIndex(gas, 'end_date')] = new Date(Date.UTC(2026, 9, 17, 21, 0, 0));
  const updated = exactRow(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 11;
    body.data[0].metrics = body.totals.slice();
  });
  const result = gas.writeWeeklyRow(updated, writeDeps(runtime));
  assert.equal(result.action, 'update');
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], 11);
});

test('конфликт схемы, дубли и формулы не изменяют прежние данные', function() {
  const gas = loadGas();
  const row = exactRow(gas);
  const mismatchBook = createMemorySpreadsheet({
    sheets: [otherSheet(), { name: 'metrika_weekly', rows: [['чужой'], [123]], formulas: [[''], ['']] }]
  });
  const mismatchBefore = sheetSnapshot(mismatchBook.getSheetByName('metrika_weekly'));
  const otherBefore = sheetSnapshot(mismatchBook.getSheetByName('Лист1'));
  const mismatchRuntime = createRuntime({ spreadsheet: mismatchBook });
  assert.throws(function() {
    gas.writeWeeklyRow(row, writeDeps(mismatchRuntime));
  }, /заголовки не совпадают/);
  assert.equal(sheetSnapshot(mismatchBook.getSheetByName('metrika_weekly')), mismatchBefore);
  assert.equal(sheetSnapshot(mismatchBook.getSheetByName('Лист1')), otherBefore);
  assert.equal(mismatchBook._insertCount, 0);
  assert.equal(mismatchRuntime.lockState.releases, 1);

  const duplicateBook = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const duplicateRuntime = createRuntime({ spreadsheet: duplicateBook });
  gas.writeWeeklyRow(row, writeDeps(duplicateRuntime));
  const duplicateSheet = duplicateBook.getSheetByName('metrika_weekly');
  duplicateSheet._rows.push(duplicateSheet._rows[1].slice());
  const duplicateBefore = sheetSnapshot(duplicateSheet);
  assert.throws(function() {
    gas.writeWeeklyRow(row, writeDeps(duplicateRuntime));
  }, /несколько строк/);
  assert.equal(sheetSnapshot(duplicateSheet), duplicateBefore);

  const formulaBook = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const formulaRuntime = createRuntime({ spreadsheet: formulaBook });
  gas.writeWeeklyRow(row, writeDeps(formulaRuntime));
  const formulaSheet = formulaBook.getSheetByName('metrika_weekly');
  const visitsCol = columnIndex(gas, 'visits');
  formulaSheet._formulas[1][visitsCol] = '=B2';
  const formulaBefore = sheetSnapshot(formulaSheet);
  assert.throws(function() {
    gas.writeWeeklyRow(row, writeDeps(formulaRuntime));
  }, /формул/);
  assert.equal(sheetSnapshot(formulaSheet), formulaBefore);
});

test('ошибка записи сохраняет прежнюю строку и отпускает блокировку', function() {
  const gas = loadGas();
  const spreadsheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const runtime = createRuntime({ spreadsheet: spreadsheet });
  const row = exactRow(gas);
  gas.writeWeeklyRow(row, writeDeps(runtime));
  spreadsheet.failDataWrite = true;
  const updated = exactRow(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 12;
    body.data[0].metrics = body.totals.slice();
  });
  assert.throws(function() {
    gas.writeWeeklyRow(updated, writeDeps(runtime));
  }, /setValues failed/);
  const sheet = spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], gas.getControlReference().visits);
  assert.equal(runtime.lockState.held, false);
  assert.equal(runtime.lockState.releases, 2);
});

test('запись в рабочую книгу и неточная строка запрещены до открытия таблицы', function() {
  const gas = loadGas();
  const forbidden = gas.getMetrikaConfig().forbiddenSpreadsheetId;
  const row = exactRow(gas);
  const runtime = createRuntime({
    openById: function() { throw new Error('opened'); }
  });
  assert.throws(function() {
    gas.writeWeeklyRow(row, writeDeps(runtime, forbidden));
  }, /запрещена/);
  assert.equal(runtime.lockState.waits, 0);

  const withheld = exactRow(gas);
  withheld.publication = 'withheld';
  withheld.sampled = true;
  assert.throws(function() {
    gas.writeWeeklyRow(withheld, writeDeps(runtime));
  }, /не отмечена как точная|семплирован/);
  assert.equal(runtime.lockState.waits, 0);
});

test('setValues, flush и releaseLock идут в этом порядке для новой строки и для следующей', function() {
  const gas = loadGas();
  const spreadsheet = createMemorySpreadsheet({ sheets: [otherSheet()] });
  const runtime = createRuntime({ spreadsheet: spreadsheet });
  const order = [];
  const originalInsert = spreadsheet.insertSheet;
  spreadsheet.insertSheet = function(name) {
    const sheet = originalInsert.call(spreadsheet, name);
    instrumentSetValues(sheet, order);
    return sheet;
  };
  const lock = runtime.deps.getLock();
  const originalRelease = lock.releaseLock.bind(lock);
  lock.releaseLock = function() {
    order.push('releaseLock');
    return originalRelease();
  };
  runtime.deps.flush = function() {
    order.push('flush');
    assert.equal(runtime.lockState.held, true);
  };

  gas.writeWeeklyRow(exactRow(gas), writeDeps(runtime));
  assert.deepEqual(order, ['setValues', 'flush', 'releaseLock']);

  order.length = 0;
  const updated = exactRow(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 10;
    body.data[0].metrics = body.totals.slice();
  });
  gas.writeWeeklyRow(updated, writeDeps(runtime));
  assert.deepEqual(order, ['setValues', 'flush', 'releaseLock']);

  order.length = 0;
  const appended = JSON.parse(JSON.stringify(updated));
  appended.definition_version = 'metrika_weekly_v2';
  gas.writeWeeklyRow(appended, writeDeps(runtime));
  assert.deepEqual(order, ['setValues', 'flush', 'releaseLock']);
  assert.equal(runtime.lockState.held, false);
});
