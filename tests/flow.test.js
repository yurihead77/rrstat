const assert = require('node:assert/strict');
const test = require('node:test');
const {
  loadGas, buildPayload, syncPayloadRow, httpResponse, createFetch, NOW, TOKEN, SHEET_ID,
  createRuntime, columnIndex, sheetSnapshot
} = require('./helpers');

function successFetch(gas, mutate) {
  return createFetch([httpResponse(200, buildPayload(gas, mutate))]);
}

test('previewControlWeek ничего не записывает и показывает сырые метрики', function() {
  const gas = loadGas();
  const fetch = successFetch(gas);
  const runtime = createRuntime({
    fetch: fetch,
    properties: { METRIKA_TOKEN: TOKEN },
    now: function() { return NOW; },
    openById: function() { throw new Error('preview открыл таблицу'); },
    getLock: function() { throw new Error('preview взял блокировку'); },
    flush: function() { throw new Error('preview вызвал flush'); }
  });
  const report = gas.previewControlWeek(runtime.deps);
  assert.equal(report.wrote, false);
  assert.equal(report.exact, true);
  assert.equal(report.row.visits, gas.getControlReference().visits);
  assert.equal(report.row.avg_visit_duration_seconds, 86.4);
  assert.match(runtime.logs.join('\n'), /Запись: не выполнялась/);
  assert.match(runtime.logs.join('\n'), /display_uncertain/);
  assert.match(runtime.logs.join('\n'), /Эталон не подставляется/);
  assert.equal(runtime.logs.join('\n').includes(TOKEN), false);
  assert.equal(fetch.calls.length, 1);
});

test('preview предупреждает о рабочей книге и не открывает её', function() {
  const gas = loadGas();
  const runtime = createRuntime({
    fetch: successFetch(gas),
    properties: {
      METRIKA_TOKEN: TOKEN,
      TARGET_SPREADSHEET_ID: gas.getMetrikaConfig().forbiddenSpreadsheetId
    },
    now: function() { return NOW; },
    openById: function() { throw new Error('opened'); }
  });
  const report = gas.previewPeriod('2026-10-12', '2026-10-18', runtime.deps);
  assert.equal(report.exact, true);
  assert.equal(report.wrote, false);
  assert.match(report.warnings.join(' '), /рабочую книгу/);
  assert.equal(runtime.spreadsheet._insertCount, 0);
});

test('importControlWeek пишет ответ API, повторно обновляет ту же строку', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const second = buildPayload(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 1515054;
    syncPayloadRow(body);
  });
  const fetch = createFetch([
    httpResponse(200, buildPayload(gas)),
    httpResponse(200, second)
  ]);
  const runtime = createRuntime({ fetch: fetch });
  const other = runtime.spreadsheet.getSheetByName('Лист1');
  const before = sheetSnapshot(other);
  const first = gas.importControlWeek(runtime.deps);
  assert.equal(first.wrote, true);
  assert.equal(first.writeResult.action, 'append');
  assert.equal(first.writeResult.spreadsheetId, SHEET_ID);
  assert.equal(first.row.visits, ref.visits);
  assert.notEqual(first.row.avg_visit_duration_seconds, ref.averageVisitDurationDisplaySeconds);
  const sheet = runtime.spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(sheet._rows[1][columnIndex(gas, 'avg_visit_duration_seconds')], 86.4);
  assert.equal(sheet._rows[1][columnIndex(gas, 'new_users')], ref.newUsersEstimate);

  const updated = gas.importControlWeek(runtime.deps);
  assert.equal(updated.writeResult.action, 'update');
  assert.equal(updated.writeResult.rowNumber, 2);
  assert.equal(sheet.getLastRow(), 2);
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], 1515054);
  assert.notEqual(sheet._rows[1][columnIndex(gas, 'fetched_at')], first.row.fetched_at);
  assert.equal(sheetSnapshot(other), before);
  assert.equal(runtime.lockState.held, false);
  assert.equal(runtime.logs.join('\n').includes(TOKEN), false);
  assert.equal(runtime.spreadsheet.openedIds.includes(gas.getMetrikaConfig().forbiddenSpreadsheetId), false);
});

test('расхождение с эталоном не подменяет записанные числа', function() {
  const gas = loadGas();
  const fetch = successFetch(gas, function(body) {
    const visits = body.query.metrics.indexOf('ym:s:visits');
    const depth = body.query.metrics.indexOf('ym:s:pageDepth');
    const fresh = body.query.metrics.indexOf('ym:s:newUsers');
    body.totals[visits] = 10;
    body.totals[depth] = 9;
    body.totals[fresh] = 391000;
    syncPayloadRow(body);
  });
  const runtime = createRuntime({ fetch: fetch, now: function() { return NOW; } });
  const report = gas.importPeriod('2026-10-12', '2026-10-18', runtime.deps);
  const sheet = runtime.spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(sheet._rows[1][columnIndex(gas, 'visits')], 10);
  assert.equal(sheet._rows[1][columnIndex(gas, 'page_depth')], 9);
  assert.equal(sheet._rows[1][columnIndex(gas, 'new_users')], 391000);
  const log = runtime.logs.join('\n');
  assert.match(log, /mismatch/);
  assert.match(log, /estimate_diff/);
  assert.match(log, /Эталон не подставляется/);
  assert.match(log, /1515053/);
  assert.equal(report.row.visits, 10);
});

test('сверка глубины и длительности не блокирует импорт полного ответа', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const apiDepth = ref.pageDepth + 4.8e-9;
  const apiDuration = 86.98575891;
  const fetch = successFetch(gas, function(body) {
    const depth = body.query.metrics.indexOf('ym:s:pageDepth');
    const duration = body.query.metrics.indexOf('ym:s:avgVisitDurationSeconds');
    body.totals[depth] = apiDepth;
    body.totals[duration] = apiDuration;
    syncPayloadRow(body);
  });
  const runtime = createRuntime({ fetch: fetch, now: function() { return NOW; } });
  const report = gas.importControlWeek(runtime.deps);
  const sheet = runtime.spreadsheet.getSheetByName('metrika_weekly');
  assert.equal(report.wrote, true);
  assert.equal(report.exact, true);
  assert.equal(sheet._rows[1][columnIndex(gas, 'page_depth')], apiDepth);
  assert.equal(sheet._rows[1][columnIndex(gas, 'avg_visit_duration_seconds')], apiDuration);
  const log = runtime.logs.join('\n');
  assert.match(log, /page_depth:[\s\S]*match/);
  assert.match(log, /display_uncertain/);
  assert.equal(log.includes('Импорт отменён'), false);
});

test('импорт запрещён в рабочую книгу, без ID и для неточного ответа', function() {
  const gas = loadGas();
  const forbidden = gas.getMetrikaConfig().forbiddenSpreadsheetId;
  const blocked = createRuntime({
    properties: { METRIKA_TOKEN: TOKEN, TARGET_SPREADSHEET_ID: forbidden },
    fetch: function() { throw new Error('fetch called'); }
  });
  assert.throws(function() { gas.importControlWeek(blocked.deps); }, /запрещена/);

  const missing = createRuntime({
    properties: { METRIKA_TOKEN: TOKEN, TARGET_SPREADSHEET_ID: '  ' },
    fetch: function() { throw new Error('fetch called'); }
  });
  assert.throws(function() { gas.importPeriod('2026-10-12', '2026-10-18', missing.deps); }, /не задан/);

  const sampled = createRuntime({
    fetch: successFetch(gas, function(body) {
      body.sampled = true;
      body.sample_share = 0.1;
    }),
    now: function() { return NOW; },
    openById: function() { throw new Error('opened'); }
  });
  assert.throws(function() { gas.importControlWeek(sampled.deps); }, /Импорт отменён/);
  assert.match(sampled.logs.join('\n'), /не выполнялась/);
  assert.equal(sampled.spreadsheet._insertCount, 0);
});

test('ошибка flush снимает блокировку и не считается успешным импортом', function() {
  const gas = loadGas();
  const runtime = createRuntime({
    fetch: successFetch(gas),
    flushError: 'flush failed',
    now: function() { return NOW; }
  });
  assert.throws(function() {
    gas.importControlWeek(runtime.deps);
  }, /flush failed/);
  assert.equal(runtime.lockState.held, false);
  assert.equal(runtime.lockState.releases, 1);
  assert.equal(runtime.logs.join('\n').includes('Запись: выполнена'), false);

  runtime.deps.flush = function() {};
  const saved = runtime.logs.length;
  gas.importControlWeek(runtime.deps);
  assert.match(runtime.logs.slice(saved).join('\n'), /Запись: выполнена/);

  runtime.deps.flush = function() { throw new Error('flush failed'); };
  const beforeFailure = runtime.logs.length;
  assert.throws(function() {
    gas.importControlWeek(runtime.deps);
  }, /flush failed/);
  assert.equal(runtime.lockState.held, false);
  assert.equal(runtime.lockState.releases, 3);
  const failureLog = runtime.logs.slice(beforeFailure).join('\n');
  assert.equal(failureLog.includes('Запись: выполнена'), false);
  assert.doesNotMatch(failureLog, /добавлена|обновлена/);
});

test('пустые даты и незавершённый период не запускают запрос и не выбирают текущую неделю', function() {
  const gas = loadGas();
  const missingDates = createRuntime({
    properties: { METRIKA_TOKEN: TOKEN },
    fetch: function() { throw new Error('fetch called'); }
  });
  assert.throws(function() {
    gas.previewConfiguredPeriod(missingDates.deps);
  }, /не выбирается автоматически/);

  const openWeek = createRuntime({
    properties: {
      METRIKA_TOKEN: TOKEN,
      TARGET_SPREADSHEET_ID: SHEET_ID,
      START_DATE: '2026-10-20',
      END_DATE: '2026-10-25'
    },
    fetch: function() { throw new Error('fetch called'); },
    now: function() { return NOW; }
  });
  assert.throws(function() {
    gas.importConfiguredPeriod(openWeek.deps);
  }, /ещё не завершён/);
});
