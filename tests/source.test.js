const assert = require('node:assert/strict');
const test = require('node:test');
const { loadGas, readSources } = require('./helpers');

const CONTROL_LITERALS = [
  '1515053',
  '461358',
  '1842092',
  '391182',
  '1019027',
  '0.8478925259776573',
  '0.8653809470691785',
  '1.2158597752025837',
  '3.2838988377789047'
];

test('конфигурация не подставляет рабочую книгу и не содержит токен', function() {
  const gas = loadGas();
  const config = gas.getMetrikaConfig();
  assert.equal(config.targetSpreadsheetId, '');
  assert.equal(config.counterId, 176199);
  assert.equal(config.timezone, 'Europe/Moscow');
  assert.equal(config.timezoneOffset, '+03:00');
  assert.equal(config.controlStartDate, '2026-10-12');
  assert.equal(config.controlEndDate, '2026-10-18');
  assert.equal(config.definitionVersion, 'metrika_weekly_v1');
  assert.notEqual(config.targetSpreadsheetId, config.forbiddenSpreadsheetId);

  const sources = readSources();
  const forbidden = config.forbiddenSpreadsheetId;
  const hits = sources.reduce(function(count, source) {
    return count + source.text.split(forbidden).length - 1;
  }, 0);
  assert.equal(hits, 1);
  assert.match(sources.find(function(source) { return source.file === 'Config.js'; }).text, /forbiddenSpreadsheetId/);

  const combined = sources.map(function(source) { return source.text; }).join('\n');
  assert.doesNotMatch(combined, /newTrigger|doGet\b|doPost\b/);
  assert.doesNotMatch(combined, /require\(|process\.env|METRIKA_TOKEN\s*[:=]\s*['"][A-Za-z0-9]/);
  assert.match(sources.find(function(source) { return source.file === 'Main.js'; }).text, /UrlFetchApp/);
  assert.match(combined, /SpreadsheetApp/);
  assert.match(combined, /LockService/);
  assert.match(combined, /PropertiesService/);
});

test('контрольные числа живут только в сверке и арифметически согласованы', function() {
  const gas = loadGas();
  const ref = gas.getControlReference();
  assert.equal(Math.round(ref.newVisitorsShare * ref.users), ref.newUsersEstimate);
  assert.equal(ref.visits / ref.users, ref.visitsPerUser);
  assert.equal(ref.pageviews / ref.visits, ref.pageDepth);
  assert.notEqual(ref.dailyUsersSumNotWeekly, ref.users);

  const sources = readSources();
  for (const source of sources) {
    if (source.file === 'ControlReference.js') continue;
    for (const literal of CONTROL_LITERALS) {
      assert.equal(source.text.includes(literal), false, source.file + ' содержит эталон ' + literal);
    }
  }
});
