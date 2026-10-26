// Проверка периода, метаданных ответа и запрета записи в рабочую книгу.

function parseIsoDate(value) {
  if (typeof value !== 'string') return null;
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  var utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return { year: year, month: month, day: day };
}

function padNumber_(value, width) {
  var text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

function formatInstantAsMoscowDate(date) {
  var shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return padNumber_(shifted.getUTCFullYear(), 4) + '-' +
    padNumber_(shifted.getUTCMonth() + 1, 2) + '-' +
    padNumber_(shifted.getUTCDate(), 2);
}

function formatFetchedAt(nowMs) {
  var shifted = new Date(nowMs + 3 * 60 * 60 * 1000);
  return padNumber_(shifted.getUTCFullYear(), 4) + '-' +
    padNumber_(shifted.getUTCMonth() + 1, 2) + '-' +
    padNumber_(shifted.getUTCDate(), 2) + 'T' +
    padNumber_(shifted.getUTCHours(), 2) + ':' +
    padNumber_(shifted.getUTCMinutes(), 2) + ':' +
    padNumber_(shifted.getUTCSeconds(), 2) + '.' +
    padNumber_(shifted.getUTCMilliseconds(), 3) + '+03:00';
}

function moscowCalendarDate(nowMs) {
  return formatInstantAsMoscowDate(new Date(nowMs));
}

function moscowInclusiveEndMs(isoDate) {
  var parts = parseIsoDate(isoDate);
  if (!parts) return NaN;
  return Date.UTC(parts.year, parts.month - 1, parts.day, 23, 59, 59, 999) - 3 * 60 * 60 * 1000;
}

function assertExplicitClosedPeriod(startDate, endDate, nowMs) {
  if (!parseIsoDate(startDate) || !parseIsoDate(endDate)) {
    throw new Error('Нужны явные даты YYYY-MM-DD. Текущая неделя не выбирается автоматически.');
  }
  if (startDate > endDate) throw new Error('Дата начала позже даты окончания.');
  var today = moscowCalendarDate(nowMs);
  if (endDate >= today) {
    throw new Error(
      'Период ' + startDate + '— ' + endDate + ' ещё не завершён в Europe/Moscow (сегодня ' + today +
      '). Нужны уже закончившиеся дни. Текущая неделя не выбирается автоматически.'
    );
  }
}

function assertSpreadsheetIdAllowed(spreadsheetId) {
  var id = spreadsheetId == null ? '' : String(spreadsheetId).trim();
  var forbidden = getMetrikaConfig().forbiddenSpreadsheetId;
  if (!id || id === 'undefined' || id === 'null' || id === 'REPLACE_ME') {
    throw new Error(
      'TARGET_SPREADSHEET_ID не задан. Импорт требует ID отдельной тестовой таблицы в Script Properties. ' +
      'Рабочая книга по умолчанию не используется.'
    );
  }
  if (id === forbidden) {
    throw new Error(
      'Запись в рабочую книгу ' + forbidden + ' запрещена. Укажите ID отдельной тестовой таблицы.'
    );
  }
  if (!/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
    throw new Error('TARGET_SPREADSHEET_ID не похож на ID таблицы. Импорт остановлен.');
  }
  return id;
}

function interpretMetrikaResponse(payload, expected) {
  var issues = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return emptyInterpretation_('Ответ Метрики пустой или не является объектом.');
  }
  var query = payload.query;
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return emptyInterpretation_('В ответе нет метаданных query.');
  }

  if (!isEmptyDimensions_(query.dimensions)) {
    issues.push('Ответ содержит группировки. Суммировать строки, включая дневных посетителей, нельзя.');
  }
  if (Array.isArray(payload.data)) {
    for (var rowIndex = 0; rowIndex < payload.data.length; rowIndex++) {
      var dataRow = payload.data[rowIndex];
      if (dataRow && !isEmptyDimensions_(dataRow.dimensions)) {
        issues.push('Строка ответа содержит группировку. Недельный итог из таких строк не собирается.');
        break;
      }
    }
  }
  if (query.preset) issues.push('Ответ построен по шаблону preset, а не по списку метрик без сегментов.');
  if (query.filters) issues.push('В ответе есть фильтр. Нужен отчёт без фильтров и сегментов.');

  var order = Array.isArray(query.metrics) ? query.metrics : null;
  if (!order) {
    issues.push('В ответе нет списка метрик.');
    order = null;
  } else if (hasDuplicateStrings_(order) || !sameStringSet_(order, expected.metrics)) {
    issues.push('Состав метрик ответа не совпадает с запросом, либо имена повторяются. Значения не сопоставлены по позиции.');
    order = null;
  }

  var datesMatch = String(query.date1 || '') === expected.startDate && String(query.date2 || '') === expected.endDate;
  if (!datesMatch) issues.push('Даты в ответе не совпадают с запросом.');
  var counterMatches = idsMatch_(query.ids, expected.counterId);
  if (!counterMatches) issues.push('Ответ относится к другому счётчику.');
  var timezoneMatches = query.timezone === expected.timezoneOffset;
  if (!timezoneMatches) issues.push('Часовой пояс ответа не +03:00.');

  var accuracyState = accuracyIsFull_(query.accuracy);
  if (accuracyState === false) issues.push('В ответе accuracy не равен full.');
  if (payload.total_rows !== 1) issues.push('total_rows не равен 1. Итог за весь период должен быть одной строкой.');
  if (payload.total_rows_rounded !== false) issues.push('total_rows_rounded показывает неполный размер ответа.');
  if (!Array.isArray(payload.data) || payload.data.length !== 1) {
    issues.push('Ожидалась одна строка data за весь период.');
  }
  if (!Array.isArray(payload.totals)) issues.push('В ответе нет totals.');
  appendAll_(issues, samplingIssues_(payload));
  var lagIssue = dataLagIssue_(payload.data_lag, expected.endDate, expected.nowMs);
  if (lagIssue) issues.push(lagIssue);

  var aligned = alignTotals_(payload, query, order);
  if (aligned === false) issues.push('totals и строка data не совпадают. Значения не угаданы.');
  if (aligned == null && order && isEmptyDimensions_(query.dimensions)) {
    var dataDimensionsEmpty = !Array.isArray(payload.data) || !payload.data[0] || isEmptyDimensions_(payload.data[0].dimensions);
    if (dataDimensionsEmpty) issues.push('Длина totals или metrics не совпадает со списком метрик.');
  }
  if (!aligned) {
    return {
      exact: false,
      issues: uniqueStrings_(issues),
      row: null,
      rawByMetric: null,
      metricOrder: Array.isArray(query.metrics) ? query.metrics.slice() : [],
      containsSensitiveData: payload.contains_sensitive_data === true
    };
  }

  var meta = {
    counterId: counterMatches && query.ids ? Number(query.ids[0]) : expected.counterId,
    startDate: datesMatch ? expected.startDate : String(query.date1 || ''),
    endDate: datesMatch ? expected.endDate : String(query.date2 || ''),
    timezone: timezoneMatches ? expected.timezone : String(query.timezone || ''),
    definitionVersion: expected.definitionVersion,
    fetchedAt: formatFetchedAt(expected.nowMs),
    accuracy: accuracyLabel_(query.accuracy, accuracyState),
    sampled: payload.sampled === true,
    sampleShare: typeof payload.sample_share === 'number' ? payload.sample_share : null,
    sampleSize: typeof payload.sample_size === 'number' ? payload.sample_size : null,
    sampleSpace: typeof payload.sample_space === 'number' ? payload.sample_space : null,
    dataLagSeconds: typeof payload.data_lag === 'number' ? payload.data_lag : null
  };
  var built = buildMetricRow(aligned, meta);
  appendAll_(issues, built.issues);
  var unique = uniqueStrings_(issues);
  var exact = unique.length === 0;
  built.row.publication = exact ? 'exact' : 'withheld';
  if (!exact) built.row.sampled = payload.sampled === false ? false : payload.sampled;
  return {
    exact: exact,
    issues: unique,
    row: built.row,
    rawByMetric: aligned,
    metricOrder: order.slice(),
    containsSensitiveData: payload.contains_sensitive_data === true
  };
}

function emptyInterpretation_(message) {
  return {
    exact: false,
    issues: [message],
    row: null,
    rawByMetric: null,
    metricOrder: [],
    containsSensitiveData: false
  };
}

function alignTotals_(payload, query, order) {
  if (!order) return null;
  if (!Array.isArray(payload.totals) || payload.totals.length !== order.length) return null;
  if (!Array.isArray(payload.data) || payload.data.length !== 1) return null;
  var dataRow = payload.data[0];
  if (!dataRow || !Array.isArray(dataRow.metrics) || dataRow.metrics.length !== order.length) return null;
  if (!isEmptyDimensions_(query.dimensions) || !isEmptyDimensions_(dataRow.dimensions)) return null;
  if (!metricVectorsAgree_(payload.totals, dataRow.metrics)) return false;
  return mapValuesByMetricName(order, payload.totals);
}

function isEmptyDimensions_(value) {
  if (value == null) return true;
  if (!Array.isArray(value)) return false;
  return value.length === 0;
}

function idsMatch_(ids, expectedCounterId) {
  if (ids == null) return true;
  if (!Array.isArray(ids) || ids.length !== 1) return false;
  return String(ids[0]) === String(expectedCounterId);
}

function accuracyIsFull_(value) {
  if (value == null || value === '') return null;
  if (value === 'full' || value === 1 || value === '1' || value === '1.0') return true;
  return false;
}

function accuracyLabel_(value, accuracyState) {
  if (accuracyState === true) return 'full';
  if (accuracyState === false) return String(value);
  return 'full';
}

function samplingIssues_(payload) {
  var issues = [];
  if (payload.sampled !== false) {
    issues.push('Ответ семплирован или признак sampled отсутствует. Как точные данные не публикуется.');
  }
  if (payload.sample_share !== 1) {
    issues.push('sample_share не равен 1. Как точные данные не публикуется.');
  }
  if (
    typeof payload.sample_size === 'number' &&
    typeof payload.sample_space === 'number' &&
    payload.sample_size !== payload.sample_space
  ) {
    issues.push('sample_size не равен sample_space.');
  }
  return issues;
}

function dataLagIssue_(dataLag, endDate, nowMs) {
  if (typeof dataLag !== 'number' || !isFinite(dataLag) || dataLag < 0) {
    return 'data_lag отсутствует или некорректен. Готовность периода не подтверждена.';
  }
  var endMs = moscowInclusiveEndMs(endDate);
  if (!(endMs <= nowMs - dataLag * 1000)) {
    return 'data_lag перекрывает конец периода. Период ещё не готов.';
  }
  return '';
}

function metricVectorsAgree_(left, right) {
  for (var i = 0; i < left.length; i++) {
    if (!sameMetricValue_(left[i], right[i])) return false;
  }
  return true;
}

function sameMetricValue_(left, right) {
  if (left === right) return true;
  if (typeof left === 'number' && typeof right === 'number' && isFinite(left) && isFinite(right)) {
    var scale = Math.max(1, Math.abs(left), Math.abs(right));
    return Math.abs(left - right) <= 1e-9 * scale;
  }
  return false;
}

function sameStringSet_(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  var seen = {};
  for (var i = 0; i < actual.length; i++) {
    if (typeof actual[i] !== 'string' || seen[actual[i]]) return false;
    seen[actual[i]] = true;
  }
  for (var j = 0; j < expected.length; j++) {
    if (!seen[expected[j]]) return false;
  }
  return true;
}

function hasDuplicateStrings_(items) {
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    if (seen[items[i]]) return true;
    seen[items[i]] = true;
  }
  return false;
}

function appendAll_(target, source) {
  for (var i = 0; i < source.length; i++) target.push(source[i]);
}

function uniqueStrings_(items) {
  var out = [];
  var seen = {};
  for (var i = 0; i < items.length; i++) {
    if (!items[i] || seen[items[i]]) continue;
    seen[items[i]] = true;
    out.push(items[i]);
  }
  return out;
}
