// Ручные точки входа. Расписание, триггеры и веб-приложение не создаются.
// Из редактора: previewControlWeek, затем отдельно importControlWeek.
// Произвольный уже завершённый период: previewConfiguredPeriod / importConfiguredPeriod
// после заполнения START_DATE и END_DATE. Текущая неделя сама не выбирается.

function previewControlWeek(deps) {
  var config = getMetrikaConfig();
  return previewPeriod(config.controlStartDate, config.controlEndDate, deps);
}

function importControlWeek(deps) {
  var config = getMetrikaConfig();
  return importPeriod(config.controlStartDate, config.controlEndDate, deps);
}

function previewConfiguredPeriod(deps) {
  var runtime = resolveRuntime_(deps);
  var dates = configuredDates_(runtime.properties);
  return previewPeriod(dates.startDate, dates.endDate, deps);
}

function importConfiguredPeriod(deps) {
  var runtime = resolveRuntime_(deps);
  var dates = configuredDates_(runtime.properties);
  return importPeriod(dates.startDate, dates.endDate, deps);
}

function previewPeriod(startDate, endDate, deps) {
  var runtime = resolveRuntime_(deps);
  var config = getMetrikaConfig();
  var nowMs = runtime.now();
  assertExplicitClosedPeriod(startDate, endDate, nowMs);
  var token = requireMetrikaToken_(runtime.properties);
  var payload = fetchMetrikaReport(reportRequest_(config, startDate, endDate, token), runtime);
  var interpreted = interpretMetrikaResponse(payload, interpretationRequest_(config, startDate, endDate, nowMs));
  var report = makeMetrikaReport_('preview', interpreted, null, startDate, endDate);
  appendTargetWarning_(report, runtime.properties);
  runtime.log(formatMetrikaReport(report));
  return report;
}

function importPeriod(startDate, endDate, deps) {
  var runtime = resolveRuntime_(deps);
  var config = getMetrikaConfig();
  var spreadsheetId = assertSpreadsheetIdAllowed(cleanProperty_(runtime.properties && runtime.properties.TARGET_SPREADSHEET_ID));
  var nowMs = runtime.now();
  assertExplicitClosedPeriod(startDate, endDate, nowMs);
  var token = requireMetrikaToken_(runtime.properties);
  var payload = fetchMetrikaReport(reportRequest_(config, startDate, endDate, token), runtime);
  var interpreted = interpretMetrikaResponse(payload, interpretationRequest_(config, startDate, endDate, nowMs));
  if (!interpreted.exact) {
    var blocked = makeMetrikaReport_('import', interpreted, null, startDate, endDate);
    runtime.log(formatMetrikaReport(blocked));
    throw new Error('Импорт отменён, таблица не изменена. ' + interpreted.issues.join(' | '));
  }
  var writeResult = writeWeeklyRow(interpreted.row, {
    spreadsheetId: spreadsheetId,
    openById: runtime.openById,
    getLock: runtime.getLock,
    flush: runtime.flush
  });
  var report = makeMetrikaReport_('import', interpreted, writeResult, startDate, endDate);
  runtime.log(formatMetrikaReport(report));
  return report;
}

function formatMetrikaReport(report) {
  var lines = [];
  lines.push('Режим: ' + report.mode);
  lines.push('Период: ' + report.startDate + ' — ' + report.endDate);
  lines.push('Запись: ' + (report.wrote ? 'выполнена' : 'не выполнялась'));
  lines.push('Точные данные: ' + (report.exact ? 'да' : 'нет'));
  if (report.warnings && report.warnings.length) lines.push('Предупреждения: ' + report.warnings.join(' | '));
  if (report.issues && report.issues.length) lines.push('Замечания: ' + report.issues.join(' | '));
  if (report.metricOrder && report.metricOrder.length && report.rawByMetric) {
    lines.push('Сырые значения по именам метрик ответа:');
    for (var i = 0; i < report.metricOrder.length; i++) {
      var name = report.metricOrder[i];
      lines.push(name + '=' + formatReportValue_(report.rawByMetric[name]));
    }
  }
  if (report.row) {
    lines.push(
      'Нормализовано: users=' + formatReportValue_(report.row.users) +
      ', new_users=' + formatReportValue_(report.row.new_users) +
      ', visits=' + formatReportValue_(report.row.visits) +
      ', pageviews=' + formatReportValue_(report.row.pageviews) +
      ', percent_new_visitors=' + formatReportValue_(report.row.percent_new_visitors) +
      ', bounce_rate=' + formatReportValue_(report.row.bounce_rate) +
      ', page_depth=' + formatReportValue_(report.row.page_depth) +
      ', avg_visit_duration_seconds=' + formatReportValue_(report.row.avg_visit_duration_seconds) +
      ', visits_per_user=' + formatReportValue_(report.row.visits_per_user)
    );
  }
  if (report.comparison && report.comparison.length) {
    for (var c = 0; c < report.comparison.length; c++) {
      var item = report.comparison[c];
      lines.push(
        item.field + ': факт=' + formatReportValue_(item.actual) +
        '; эталон=' + formatReportValue_(item.reference) +
        '; Δ=' + formatReportValue_(item.delta) +
        '; ' + item.status +
        (item.note ? '; ' + item.note : '')
      );
    }
    lines.push('Эталон не подставляется вместо ответа API.');
  }
  if (report.writeResult) {
    var action = report.writeResult.action === 'update' ? 'обновлена' : 'добавлена';
    lines.push(
      'Лист ' + report.writeResult.sheetName + ', строка ' + report.writeResult.rowNumber +
      ' ' + action + '. Таблица: ' + report.writeResult.spreadsheetId
    );
  }
  return lines.join('\n');
}

function makeMetrikaReport_(mode, interpreted, writeResult, startDate, endDate) {
  var comparison = [];
  if (isControlPeriod(startDate, endDate) && interpreted.row) comparison = compareWithControl(interpreted.row);
  return {
    mode: mode,
    startDate: startDate,
    endDate: endDate,
    wrote: !!writeResult,
    exact: interpreted.exact,
    issues: interpreted.issues,
    warnings: [],
    row: interpreted.row,
    rawByMetric: interpreted.rawByMetric,
    metricOrder: interpreted.metricOrder,
    containsSensitiveData: interpreted.containsSensitiveData,
    comparison: comparison,
    writeResult: writeResult
  };
}

function appendTargetWarning_(report, properties) {
  var target = cleanProperty_(properties && properties.TARGET_SPREADSHEET_ID);
  var forbidden = getMetrikaConfig().forbiddenSpreadsheetId;
  if (target && target === forbidden) {
    report.warnings.push(
      'TARGET_SPREADSHEET_ID указывает на рабочую книгу. Preview ничего не записывает. Импорт в эту книгу запрещён.'
    );
  }
}

function reportRequest_(config, startDate, endDate, token) {
  return {
    token: token,
    counterId: config.counterId,
    startDate: startDate,
    endDate: endDate,
    metrics: getRequestedMetricNames()
  };
}

function interpretationRequest_(config, startDate, endDate, nowMs) {
  return {
    counterId: config.counterId,
    startDate: startDate,
    endDate: endDate,
    metrics: getRequestedMetricNames(),
    timezone: config.timezone,
    timezoneOffset: config.timezoneOffset,
    definitionVersion: config.definitionVersion,
    nowMs: nowMs
  };
}

function configuredDates_(properties) {
  var startDate = cleanProperty_(properties && properties.START_DATE);
  var endDate = cleanProperty_(properties && properties.END_DATE);
  if (!startDate || !endDate) {
    throw new Error(
      'Укажите START_DATE и END_DATE в Script Properties. Текущая незавершённая неделя не выбирается автоматически.'
    );
  }
  return { startDate: startDate, endDate: endDate };
}

function requireMetrikaToken_(properties) {
  var token = cleanProperty_(properties && properties.METRIKA_TOKEN);
  if (!token) {
    throw new Error(
      'METRIKA_TOKEN не найден в Script Properties. Добавьте токен вручную в редакторе Apps Script. ' +
      'Не отправляйте токен в чат и не записывайте его в файлы проекта.'
    );
  }
  return token;
}

function cleanProperty_(value) {
  if (value == null) return '';
  var text = String(value).trim();
  if (!text || text === 'undefined' || text === 'null' || text === 'REPLACE_ME') return '';
  return text;
}

function formatReportValue_(value) {
  if (value === null || typeof value === 'undefined' || value === '') return 'пусто';
  return String(value);
}

function resolveRuntime_(deps) {
  if (!deps) return liveRuntime_();
  return {
    properties: deps.properties || {},
    fetch: deps.fetch || missingRuntimeDep_('fetch'),
    sleep: deps.sleep || missingRuntimeDep_('sleep'),
    now: deps.now || function() { return Date.now(); },
    log: deps.log || function() {},
    openById: deps.openById || missingRuntimeDep_('openById'),
    getLock: deps.getLock || missingRuntimeDep_('getLock'),
    flush: deps.flush || missingRuntimeDep_('flush')
  };
}

function missingRuntimeDep_(name) {
  return function() {
    throw new Error('Зависимость ' + name + ' не задана.');
  };
}

function liveRuntime_() {
  return {
    properties: readLiveProperties_(),
    fetch: function(url, options) { return UrlFetchApp.fetch(url, options); },
    sleep: function(ms) { Utilities.sleep(ms); },
    now: function() { return Date.now(); },
    log: function(message) { console.log(message); },
    openById: function(id) { return SpreadsheetApp.openById(id); },
    getLock: function() { return LockService.getScriptLock(); },
    flush: function() { SpreadsheetApp.flush(); }
  };
}

function readLiveProperties_() {
  var store = PropertiesService.getScriptProperties();
  return {
    METRIKA_TOKEN: store.getProperty('METRIKA_TOKEN'),
    TARGET_SPREADSHEET_ID: store.getProperty('TARGET_SPREADSHEET_ID'),
    START_DATE: store.getProperty('START_DATE'),
    END_DATE: store.getProperty('END_DATE')
  };
}
