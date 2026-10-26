const assert = require('node:assert/strict');
const test = require('node:test');
const { loadGas, buildPayload, syncPayloadRow, expectedRequest, NOW } = require('./helpers');

test('проценты API делятся на 100, ноль остаётся нулём, пусто не становится нулём', function() {
  const gas = loadGas();
  assert.equal(gas.normalizePercentPoints(0).value, 0);
  assert.equal(gas.normalizePercentPoints(100).value, 1);
  assert.equal(gas.normalizePercentPoints(86.53809470691785).value, 0.8653809470691785);
  assert.equal(gas.normalizePercentPoints(null).value, null);
  assert.equal(gas.normalizePercentPoints(null).missing, true);
  assert.equal(gas.normalizePercentPoints('').value, null);
  assert.equal(gas.normalizePercentPoints(undefined).missing, true);
  assert.equal(gas.normalizePercentPoints(-1).invalid, true);
  assert.equal(gas.normalizePercentPoints(100.1).invalid, true);
  assert.equal(gas.normalizePercentPoints('86').invalid, true);
});

test('visits_per_user не делит на ноль и не подменяет пусто нулём', function() {
  const gas = loadGas();
  assert.equal(gas.visitsPerUser(10, 0), null);
  assert.equal(gas.visitsPerUser(0, 0), null);
  assert.equal(gas.visitsPerUser(10, null), null);
  assert.equal(gas.visitsPerUser(null, 5), null);
  assert.equal(gas.visitsPerUser(1515053, 461358), 1515053 / 461358);
});

test('нулевой отказ остаётся нулём, пустой users не записывается как ноль', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const zeroBounce = buildPayload(gas, function(payload) {
    const bounce = payload.query.metrics.indexOf('ym:s:bounceRate');
    payload.totals[bounce] = 0;
    syncPayloadRow(payload);
  });
  const bounceResult = gas.interpretMetrikaResponse(zeroBounce, expectedRequest(gas, NOW));
  assert.equal(bounceResult.exact, true);
  assert.equal(bounceResult.row.bounce_rate, 0);

  const missingUsers = buildPayload(gas, function(payload) {
    const users = payload.query.metrics.indexOf('ym:s:users');
    payload.totals[users] = null;
    syncPayloadRow(payload);
  });
  const missing = gas.interpretMetrikaResponse(missingUsers, expectedRequest(gas, NOW));
  assert.equal(missing.exact, false);
  assert.equal(missing.row.users, null);
  assert.equal(missing.row.visits_per_user, null);
  assert.match(missing.issues.join(' '), /не заменяется нулём/);

  const emptyWeek = buildPayload(gas, function(payload) {
    payload.totals = payload.query.metrics.map(function() { return 0; });
    syncPayloadRow(payload);
  });
  const empty = gas.interpretMetrikaResponse(emptyWeek, expectedRequest(gas, NOW));
  assert.equal(empty.exact, true);
  assert.equal(empty.row.users, 0);
  assert.equal(empty.row.visits, 0);
  assert.equal(empty.row.visits_per_user, null);
  assert.equal(empty.row.percent_new_visitors, 0);
  assert.notEqual(ref.users, 0);
});

test('недельные уникальные не складываются из дневных строк', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const payload = buildPayload(gas, function(body) {
    body.query.dimensions = ['ym:s:date'];
    body.total_rows = 7;
    const usersIndex = body.query.metrics.indexOf('ym:s:users');
    const daily = [145575, 145575, 145575, 145575, 145575, 145575, 145577];
    let sum = 0;
    body.data = daily.map(function(users) {
      sum += users;
      return {
        dimensions: [{ name: '2026-10-12' }],
        metrics: body.query.metrics.map(function(name, index) {
          return index === usersIndex ? users : 0;
        })
      };
    });
    body.totals = body.query.metrics.map(function(name, index) {
      return index === usersIndex ? sum : 0;
    });
    assert.equal(sum, ref.dailyUsersSumNotWeekly);
  });
  const result = gas.interpretMetrikaResponse(payload, expectedRequest(gas, NOW));
  assert.equal(result.row, null);
  assert.equal(result.exact, false);
  assert.match(result.issues.join(' '), /группировк/);
  assert.equal(JSON.stringify(result).includes('"users":1019027'), false);
});

test('значения сопоставляются с именами метрик, а не с позицией', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const payload = buildPayload(gas, function(body) {
    body.query.metrics = body.query.metrics.slice().reverse();
    body.totals = body.totals.slice().reverse();
    body.data[0].metrics = body.data[0].metrics.slice().reverse();
  });
  const result = gas.interpretMetrikaResponse(payload, expectedRequest(gas, NOW));
  assert.equal(result.exact, true);
  assert.equal(result.metricOrder[0], 'ym:s:avgVisitDurationSeconds');
  assert.equal(result.row.users, ref.users);
  assert.equal(result.row.visits, ref.visits);
  assert.equal(result.row.avg_visit_duration_seconds, 86.4);
  assert.equal(result.rawByMetric['ym:s:percentNewVisitors'] / 100, ref.newVisitorsShare);
});

test('глубина просмотра берётся из API и не пересчитывается из просмотров', function() {
  const gas = loadGas();
  const payload = buildPayload(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:pageDepth');
    body.totals[index] = 9;
    syncPayloadRow(body);
  });
  const result = gas.interpretMetrikaResponse(payload, expectedRequest(gas, NOW));
  assert.equal(result.row.page_depth, 9);
  assert.notEqual(result.row.page_depth, result.row.pageviews / result.row.visits);
});

test('сверка показывает разницу и не подменяет строку эталоном', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const payload = buildPayload(gas);
  const result = gas.interpretMetrikaResponse(payload, expectedRequest(gas, NOW));
  const before = result.row.visits;
  const comparison = gas.compareWithControl(result.row);
  assert.equal(result.row.visits, before);
  assert.equal(comparison.find(function(item) { return item.field === 'visits'; }).status, 'match');
  assert.equal(comparison.find(function(item) { return item.field === 'avg_visit_duration_seconds'; }).status, 'display_uncertain');
  assert.equal(comparison.find(function(item) { return item.field === 'new_users'; }).status, 'estimate_match');
  assert.equal(result.row.avg_visit_duration_seconds, 86.4);
  assert.notEqual(result.row.avg_visit_duration_seconds, ref.averageVisitDurationDisplaySeconds);

  result.row.visits = 10;
  const drifted = gas.compareWithControl(result.row);
  assert.equal(result.row.visits, 10);
  assert.equal(drifted.find(function(item) { return item.field === 'visits'; }).status, 'mismatch');
  assert.equal(drifted.find(function(item) { return item.field === 'visits'; }).reference, ref.visits);
});

test('глубина с отличием около 4.8e-9 совпадает, длительность API не подменяется показанными 86 секундами', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  const apiDepth = ref.pageDepth + 4.8e-9;
  const apiDuration = 86.98575891;
  const row = {
    visits: ref.visits,
    users: ref.users,
    pageviews: ref.pageviews,
    percent_new_visitors: ref.newVisitorsShare,
    bounce_rate: ref.bounceRate,
    page_depth: apiDepth,
    avg_visit_duration_seconds: apiDuration,
    visits_per_user: ref.visitsPerUser,
    new_users: ref.newUsersEstimate
  };
  const comparison = gas.compareWithControl(row);
  const depth = comparison.find(function(item) { return item.field === 'page_depth'; });
  const duration = comparison.find(function(item) { return item.field === 'avg_visit_duration_seconds'; });
  assert.ok(Math.abs(apiDepth - ref.pageDepth) > 1e-9);
  assert.ok(Math.abs(apiDepth - ref.pageDepth) <= 1e-8);
  assert.equal(depth.status, 'match');
  assert.equal(row.page_depth, apiDepth);
  assert.equal(duration.status, 'display_uncertain');
  assert.equal(duration.actual, apiDuration);
  assert.equal(row.avg_visit_duration_seconds, apiDuration);
  assert.match(duration.note, /не считаются доказанными/);

  row.page_depth = ref.pageDepth + 2e-8;
  const wider = gas.compareWithControl(row).find(function(item) { return item.field === 'page_depth'; });
  assert.equal(wider.status, 'mismatch');

  row.avg_visit_duration_seconds = 87;
  const nextSecond = gas.compareWithControl(row).find(function(item) {
    return item.field === 'avg_visit_duration_seconds';
  });
  assert.equal(nextSecond.status, 'mismatch');
  assert.equal(row.avg_visit_duration_seconds, 87);
});

test('дробный визит и строковое число не публикуются как точные', function() {
  const gas = loadGas();
  const fractional = buildPayload(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = 1515053.4;
    syncPayloadRow(body);
  });
  const fractionalResult = gas.interpretMetrikaResponse(fractional, expectedRequest(gas, NOW));
  assert.equal(fractionalResult.exact, false);
  assert.equal(fractionalResult.row.visits, null);
  assert.equal(fractionalResult.rawByMetric['ym:s:visits'], 1515053.4);

  const textual = buildPayload(gas, function(body) {
    const index = body.query.metrics.indexOf('ym:s:visits');
    body.totals[index] = '1515053';
    syncPayloadRow(body);
  });
  const textualResult = gas.interpretMetrikaResponse(textual, expectedRequest(gas, NOW));
  assert.equal(textualResult.exact, false);
  assert.equal(textualResult.row.publication, 'withheld');
});
