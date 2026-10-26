const assert = require('node:assert/strict');
const test = require('node:test');
const { loadGas, buildPayload, syncPayloadRow, expectedRequest, NOW } = require('./helpers');

function interpret(gas, mutate, nowMs) {
  return gas.interpretMetrikaResponse(buildPayload(gas, mutate), expectedRequest(gas, nowMs == null ? NOW : nowMs));
}

test('принимается один полный итог без семплирования', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const result = interpret(gas);
  assert.equal(result.exact, true);
  assert.equal(result.row.publication, 'exact');
  assert.equal(result.row.users, ref.users);
  assert.equal(result.row.visits, ref.visits);
  assert.equal(result.row.pageviews, ref.pageviews);
  assert.equal(result.row.percent_new_visitors, ref.newVisitorsShare);
  assert.equal(result.row.bounce_rate, ref.bounceRate);
  assert.equal(result.row.page_depth, ref.pageDepth);
  assert.equal(result.row.visits_per_user, ref.visitsPerUser);
  assert.equal(result.row.timezone, 'Europe/Moscow');
  assert.equal(result.row.definition_version, 'metrika_weekly_v1');
  assert.equal(result.row.fetched_at, '2026-10-25T12:00:00.000+03:00');
  assert.equal(result.row.sampled, false);
  assert.equal(result.row.sample_share, 1);
  assert.equal(result.row.data_lag_seconds, 0);
});

test('семплированный, неполный и неготовый ответ не точный', function() {
  const gas = loadGas();
  const sampled = interpret(gas, function(body) {
    body.sampled = true;
    body.sample_share = 0.25;
  });
  assert.equal(sampled.exact, false);
  assert.equal(sampled.row.publication, 'withheld');
  assert.match(sampled.issues.join(' '), /семплир/);

  const share = interpret(gas, function(body) { body.sample_share = '1'; });
  assert.equal(share.exact, false);
  assert.match(share.issues.join(' '), /sample_share/);

  const missingFlag = interpret(gas, function(body) { delete body.sampled; });
  assert.equal(missingFlag.exact, false);

  const unequalSample = interpret(gas, function(body) { body.sample_size = 10; body.sample_space = 20; });
  assert.equal(unequalSample.exact, false);

  const lag = interpret(gas, function(body) { body.data_lag = 7 * 24 * 60 * 60; });
  assert.equal(lag.exact, false);
  assert.match(lag.issues.join(' '), /data_lag/);

  const missingLag = interpret(gas, function(body) { delete body.data_lag; });
  assert.equal(missingLag.exact, false);

  const rounded = interpret(gas, function(body) { body.total_rows_rounded = true; });
  assert.equal(rounded.exact, false);

  const empty = interpret(gas, function(body) {
    body.data = [];
    body.total_rows = 0;
  });
  assert.equal(empty.row, null);
  assert.equal(empty.exact, false);
});

test('фильтр, шаблон, чужой пояс, чужая точность и расхождение totals блокируют публикацию', function() {
  const gas = loadGas();
  assert.equal(interpret(gas, function(body) { body.query.filters = "ym:s:isRobot=='No'"; }).exact, false);
  assert.equal(interpret(gas, function(body) { body.query.preset = 'traffic'; }).exact, false);
  const timezone = interpret(gas, function(body) { body.query.timezone = '+00:00'; });
  assert.equal(timezone.exact, false);
  assert.equal(timezone.row.timezone, '+00:00');
  assert.equal(interpret(gas, function(body) { body.query.accuracy = 'medium'; }).exact, false);
  assert.equal(interpret(gas, function(body) { body.query.accuracy = 1; }).exact, true);
  assert.equal(interpret(gas, function(body) { body.query.ids = [1]; }).exact, false);

  const mismatch = interpret(gas, function(body) {
    body.data[0].metrics = body.totals.slice();
    body.data[0].metrics[0] = 1;
  });
  assert.equal(mismatch.row, null);
  assert.match(mismatch.issues.join(' '), /не совпадают/);

  const missingMetric = interpret(gas, function(body) {
    body.query.metrics = body.query.metrics.slice(1);
    body.totals = body.totals.slice(1);
    syncPayloadRow(body);
  });
  assert.equal(missingMetric.row, null);
  assert.match(missingMetric.issues.join(' '), /Состав метрик/);
});

test('незавершённый период отклоняется до запроса, рабочая книга запрещена', function() {
  const gas = loadGas();
  const config = gas.getMetrikaConfig();
  assert.doesNotThrow(function() {
    gas.assertExplicitClosedPeriod(config.controlStartDate, config.controlEndDate, NOW);
  });
  assert.throws(function() {
    gas.assertExplicitClosedPeriod('2026-10-12', '2026-10-25', NOW);
  }, /не выбирается автоматически/);
  assert.throws(function() {
    gas.assertExplicitClosedPeriod('2026-10-18', '2026-10-18', Date.parse('2026-10-18T12:00:00+03:00'));
  }, /ещё не завершён/);
  assert.throws(function() {
    gas.assertExplicitClosedPeriod('2026-10-19', '2026-10-12', NOW);
  }, /позже/);
  assert.throws(function() {
    gas.assertExplicitClosedPeriod('', '', NOW);
  }, /YYYY-MM-DD/);

  assert.throws(function() {
    gas.assertSpreadsheetIdAllowed('');
  }, /не задан/);
  assert.throws(function() {
    gas.assertSpreadsheetIdAllowed('   ');
  }, /не задан/);
  assert.throws(function() {
    gas.assertSpreadsheetIdAllowed(' ' + config.forbiddenSpreadsheetId + ' ');
  }, /запрещена/);
  assert.equal(gas.assertSpreadsheetIdAllowed(' test-spreadsheet-id-0001 '), 'test-spreadsheet-id-0001');
});
