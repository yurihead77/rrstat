// Нормализация значений Метрики. Положение в массиве ответа здесь не угадывается:
// вызывающий код уже сопоставил число с именем метрики.

var METRIKA_MAX_SAFE_INTEGER = 9007199254740991;

function normalizePercentPoints(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return { value: null, missing: true, invalid: false };
  }
  if (typeof value !== 'number' || !isFinite(value)) {
    return { value: null, missing: false, invalid: true };
  }
  if (value < 0 || value > 100) {
    return { value: null, missing: false, invalid: true };
  }
  return { value: value / 100, missing: false, invalid: false };
}

function visitsPerUser(visits, users) {
  if (typeof visits !== 'number' || typeof users !== 'number') return null;
  if (!isFinite(visits) || !isFinite(users)) return null;
  if (users === 0) return null;
  return visits / users;
}

function mapValuesByMetricName(names, values) {
  var mapped = {};
  for (var i = 0; i < names.length; i++) mapped[names[i]] = values[i];
  return mapped;
}

function buildMetricRow(rawByName, meta) {
  var catalog = getMetricCatalog();
  var row = {
    counter_id: meta.counterId,
    start_date: meta.startDate,
    end_date: meta.endDate,
    timezone: meta.timezone,
    definition_version: meta.definitionVersion,
    fetched_at: meta.fetchedAt,
    accuracy: meta.accuracy,
    sampled: meta.sampled,
    sample_share: meta.sampleShare,
    sample_size: meta.sampleSize,
    sample_space: meta.sampleSpace,
    data_lag_seconds: meta.dataLagSeconds,
    publication: 'withheld'
  };
  var issues = [];
  for (var i = 0; i < catalog.length; i++) {
    var metric = catalog[i];
    var parsed = convertMetricValue_(metric, rawByName[metric.apiName]);
    row[metric.field] = parsed.value;
    if (parsed.issue) issues.push(parsed.issue);
  }
  row.visits_per_user = visitsPerUser(row.visits, row.users);
  return { row: row, issues: issues };
}

function convertMetricValue_(metric, value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return {
      value: null,
      issue: 'Метрика ' + metric.apiName + ' пустая. Пустое значение не заменяется нулём.'
    };
  }
  if (typeof value !== 'number' || !isFinite(value)) {
    return {
      value: null,
      issue: 'Метрика ' + metric.apiName + ' имеет неподходящий тип.'
    };
  }
  if (metric.kind === 'percent') {
    var percent = normalizePercentPoints(value);
    if (percent.invalid || percent.missing) {
      return {
        value: null,
        issue: 'Метрика ' + metric.apiName + ' выходит за пределы 0–100 процентных пунктов.'
      };
    }
    return { value: percent.value, issue: '' };
  }
  if (value < 0) {
    return { value: null, issue: 'Метрика ' + metric.apiName + ' отрицательная.' };
  }
  if (metric.kind === 'count' && !isWholeMetricNumber_(value)) {
    return {
      value: null,
      issue: 'Метрика ' + metric.apiName + ' не является целым числом. Дробный итог не публикуется как точный.'
    };
  }
  if ((metric.kind === 'decimal' || metric.kind === 'seconds') && !isFinite(value)) {
    return { value: null, issue: 'Метрика ' + metric.apiName + ' не является числом.' };
  }
  return { value: value, issue: '' };
}

function isWholeMetricNumber_(value) {
  return Math.abs(value) <= METRIKA_MAX_SAFE_INTEGER && Math.abs(value - Math.round(value)) <= 1e-9;
}
