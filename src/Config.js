// Конфигурация без секретов. METRIKA_TOKEN и TARGET_SPREADSHEET_ID читаются только из Script Properties.

var METRIKA_DEFINITION_VERSION = 'metrika_weekly_v1';

function getMetrikaConfig() {
  return {
    ownerAccount: 'art@radiorecord.ru',
    site: 'www.radiorecord.ru',
    counterId: 176199,
    timezone: 'Europe/Moscow',
    timezoneOffset: '+03:00',
    definitionVersion: METRIKA_DEFINITION_VERSION,
    sheetName: 'metrika_weekly',
    // Рабочая книга. Идентификатор разрешён только для запрета записи, не как цель по умолчанию.
    forbiddenSpreadsheetId: '1SY4NGY1jTAR9pZG9K0g-2xCffT_8UYuK5wkMNm-8Wvg',
    targetSpreadsheetId: '',
    controlStartDate: '2026-10-12',
    controlEndDate: '2026-10-18',
    apiUrl: 'https://api-metrika.yandex.net/stat/v1/data',
    maxAttempts: 4,
    maxSleepMs: 5000,
    retryBudgetMs: 15000,
    lockWaitMs: 20000
  };
}

// Все метрики — множество визитов ym:s:. В одном запросе API нельзя смешивать префиксы.
// Набор посещаемости совпадает с шаблоном traffic, плюс ym:s:newUsers из того же множества.
// Типы по документации Метрики:
// int: users, newUsers, visits, pageviews
// percents: percentNewVisitors, bounceRate — в ответе API это проценты, в таблице хранится доля 0–1
// double: pageDepth
// second: avgVisitDurationSeconds
function getMetricCatalog() {
  return [
    { apiName: 'ym:s:users', field: 'users', kind: 'count' },
    { apiName: 'ym:s:newUsers', field: 'new_users', kind: 'count' },
    { apiName: 'ym:s:visits', field: 'visits', kind: 'count' },
    { apiName: 'ym:s:pageviews', field: 'pageviews', kind: 'count' },
    { apiName: 'ym:s:percentNewVisitors', field: 'percent_new_visitors', kind: 'percent' },
    { apiName: 'ym:s:bounceRate', field: 'bounce_rate', kind: 'percent' },
    { apiName: 'ym:s:pageDepth', field: 'page_depth', kind: 'decimal' },
    { apiName: 'ym:s:avgVisitDurationSeconds', field: 'avg_visit_duration_seconds', kind: 'seconds' }
  ];
}

function getRequestedMetricNames() {
  var catalog = getMetricCatalog();
  var names = [];
  for (var i = 0; i < catalog.length; i++) names.push(catalog[i].apiName);
  return names;
}

function getSheetColumns() {
  return [
    'counter_id',
    'start_date',
    'end_date',
    'timezone',
    'definition_version',
    'users',
    'new_users',
    'visits',
    'pageviews',
    'percent_new_visitors',
    'bounce_rate',
    'page_depth',
    'avg_visit_duration_seconds',
    'visits_per_user',
    'fetched_at',
    'accuracy',
    'sampled',
    'sample_share',
    'sample_size',
    'sample_space',
    'data_lag_seconds',
    'publication'
  ];
}

function getColumnFormat(name) {
  if (
    name === 'start_date' ||
    name === 'end_date' ||
    name === 'timezone' ||
    name === 'definition_version' ||
    name === 'fetched_at' ||
    name === 'accuracy' ||
    name === 'publication'
  ) {
    return '@';
  }
  if (name === 'sampled') return 'General';
  if (name === 'percent_new_visitors' || name === 'bounce_rate') return '0.0000%';
  if (name === 'page_depth' || name === 'visits_per_user' || name === 'sample_share') return '0.000000';
  if (name === 'avg_visit_duration_seconds') return '0.00';
  return '0';
}
