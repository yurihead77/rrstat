// ДОПОЛНИТЕЛЬНЫЙ файл для существующего metrika-weekly. Ничего не заменяет в текущем проекте.
// Запись разрешена только в TARGET_SPREADSHEET_ID при прохождении assertSpreadsheetIdAllowed.
// Основная Google-таблица никогда не открывается этим модулем.

var SITE_DEFINITION_VERSION = 'metrika_site_weekly_v1';
var SITE_WEEKLY_SHEET = 'metrika_site_weekly';
var SITE_VIEW_SHEET = 'site_report_preview';
var SITE_MOBILE_FILTER = "ym:s:deviceCategory=.('mobile','tablet')";

function siteUrlItems_() {
  return [
    { field: 'pv_home', label: '/', filterDimension: 'ym:pv:URLPath', path: '/' },
    { field: 'pv_stations', label: '/stations/', filterDimension: 'ym:pv:URLPath', path: '/stations/' },
    { field: 'pv_rus', label: '/station/rus', filterDimension: 'ym:pv:URLPath', path: '/station/rus' },
    { field: 'pv_event', label: '/event/', filterDimension: 'ym:pv:URLPath', path: '/event/' },
    { field: 'pv_megamix', label: 'Megamix /podcast/15761', filterDimension: 'ym:pv:URLPath', path: '/podcast/15761' },
    { field: 'pv_newest', label: 'Свежаки /chart/newest', filterDimension: 'ym:pv:URLPath', path: '/chart/newest' },
    { field: 'pv_superchart', label: 'Суперчарт /chart/superchart', filterDimension: 'ym:pv:URLPath', path: '/chart/superchart' },
    { field: 'pv_deep', label: '/station/deep', filterDimension: 'ym:pv:URLPath', path: '/station/deep' },
    { field: 'pv_clubchart', label: '/chart/clubchart', filterDimension: 'ym:pv:URLPath', path: '/chart/clubchart' },
    // В этой строке нужен параметр st=rr; URLPath его отбрасывает. Используем URLPathFull.
    { field: 'pv_radio_stations_rr', label: '/radio/stations/?st=rr', filterDimension: 'ym:pv:URLPathFull', path: '/radio/stations/?st=rr' }
  ];
}

function siteColumns_() {
  var names = [
    'counter_id', 'start_date', 'end_date', 'timezone', 'definition_version',
    'users', 'new_users', 'visits', 'pageviews', 'percent_new_visitors',
    'bounce_rate', 'page_depth', 'avg_visit_duration_seconds', 'visits_per_user',
    'android_visits', 'android_users', 'android_new_users',
    'ios_visits', 'ios_users', 'ios_new_users',
    'mobile_visits', 'mobile_users', 'mobile_new_users',
    'source_organic_users', 'source_direct_users', 'source_referral_users', 'source_social_users'
  ];
  var urls = siteUrlItems_();
  for (var i = 0; i < urls.length; i++) names.push(urls[i].field);
  return names.concat([
    'fetched_at', 'accuracy', 'sampled', 'sample_share', 'data_lag_seconds',
    'traffic_attribution', 'publication'
  ]);
}

// Публичные функции запуска из редактора Apps Script.
function previewSiteControlWeek(deps) {
  var conf = getMetrikaConfig();
  return previewSiteWeek(conf.controlStartDate, conf.controlEndDate, deps);
}
function importSiteControlWeek(deps) {
  var conf = getMetrikaConfig();
  return importSiteWeek(conf.controlStartDate, conf.controlEndDate, deps);
}
function previewSiteConfiguredWeek(deps) {
  var runtime = resolveRuntime_(deps);
  var dates = configuredDates_(runtime.properties);
  return previewSiteWeek(dates.startDate, dates.endDate, deps);
}
function importSiteConfiguredWeek(deps) {
  var runtime = resolveRuntime_(deps);
  var dates = configuredDates_(runtime.properties);
  return importSiteWeek(dates.startDate, dates.endDate, deps);
}

function previewSiteWeek(startDate, endDate, deps) {
  var runtime = resolveRuntime_(deps);
  var report = collectSiteWeek_(startDate, endDate, runtime);
  var safeTarget = cleanProperty_(runtime.properties.TARGET_SPREADSHEET_ID);
  if (safeTarget === getMetrikaConfig().forbiddenSpreadsheetId) {
    report.warnings.push('TARGET_SPREADSHEET_ID указывает на основную книгу, запись в неё запрещена.');
  }
  runtime.log(siteLog_(report, 'preview', null));
  return report;
}

function importSiteWeek(startDate, endDate, deps) {
  var runtime = resolveRuntime_(deps);
  // Запрет применяется ДО запроса в API и до открытия каких-либо таблиц.
  var sheetId = assertSpreadsheetIdAllowed(cleanProperty_(runtime.properties.TARGET_SPREADSHEET_ID));
  var report = collectSiteWeek_(startDate, endDate, runtime);
  // Даже частично полученные данные не попадают в таблицу.
  if (!report.exact) throw new Error('Неполный набор метрик. Ничего не записано.');
  var flush = deps && deps.flush ? deps.flush : function() { SpreadsheetApp.flush(); };
  var write = writeSiteWeekAndView_(report.row, {
    spreadsheetId: sheetId,
    openById: runtime.openById,
    getLock: runtime.getLock,
    flush: flush
  });
  runtime.log(siteLog_(report, 'import', write));
  report.writeResult = write;
  return report;
}

function siteLog_(report, mode, write) {
  var row = report.row;
  return [
    'Сайт, режим: ' + mode,
    'Неделя: ' + row.start_date + ' — ' + row.end_date,
    'Точность: ' + (report.exact ? 'полная' : 'не подтверждена'),
    'API-запросов: ' + report.requests,
    'Посетители: ' + row.users + ', визиты: ' + row.visits + ', новые: ' + row.new_users,
    'Android: ' + row.android_users + ', iOS: ' + row.ios_users + ', mobile+tablet: ' + row.mobile_users,
    'Просмотров отдельных URL: ' + siteUrlItems_().length,
    'ОС вне Android/iOS: ' + report.otherMobileOs.join(', '),
    'Предупреждения: ' + (report.warnings.length ? report.warnings.join(' | ') : 'нет'),
    write ? ('Запись: ' + write.action + ', лист ' + SITE_WEEKLY_SHEET + ', представление ' + SITE_VIEW_SHEET) : 'Запись: отсутствует'
  ].join('\n');
}

function collectSiteWeek_(startDate, endDate, runtime) {
  var conf = getMetrikaConfig();
  var nowMs = runtime.now();
  assertSiteFullWeek_(startDate, endDate, nowMs);
  var token = requireMetrikaToken_(runtime.properties);
  var baseMetrics = getRequestedMetricNames();
  var basePayload = fetchMetrikaReport({
    token: token, counterId: conf.counterId,
    startDate: startDate, endDate: endDate, metrics: baseMetrics
  }, runtime);
  var base = interpretMetrikaResponse(basePayload, interpretationRequest_(conf, startDate, endDate, nowMs));
  if (!base.exact || !base.row) {
    throw new Error('Общая посещаемость не прошла проверку: ' + (base.issues || []).join(' | '));
  }
  var row = {};
  var columns = getSheetColumns();
  for (var i = 0; i < columns.length; i++) row[columns[i]] = base.row[columns[i]];
  row.definition_version = SITE_DEFINITION_VERSION;
  var count = 1;
  var warnings = [];

  var subsetMetrics = ['ym:s:visits', 'ym:s:users', 'ym:s:newUsers'];
  var mobileReq = siteQuery_(startDate, endDate, subsetMetrics, [], SITE_MOBILE_FILTER, 1);
  var mobileResponse = siteRequest_(mobileReq, token, runtime);
  var mobile = siteReadTotals_(mobileResponse, mobileReq, nowMs);
  count++;
  row.mobile_visits = siteCount_(mobile['ym:s:visits'], 'mobile visits');
  row.mobile_users = siteCount_(mobile['ym:s:users'], 'mobile users');
  row.mobile_new_users = siteCount_(mobile['ym:s:newUsers'], 'mobile new users');

  var osReq = siteQuery_(startDate, endDate, subsetMetrics, ['ym:s:operatingSystemRoot'], SITE_MOBILE_FILTER, 100);
  var osResponse = siteRequest_(osReq, token, runtime);
  var osData = siteReadGroups_(osResponse, osReq, nowMs);
  count++;
  var osSeen = { android: false, ios: false };
  var otherOs = [];
  for (i = 0; i < osData.length; i++) {
    var os = osData[i];
    var category = siteMobileOs_(os.dimension);
    if (category === 'android' || category === 'ios') {
      if (osSeen[category]) throw new Error('Группа ОС ' + category + ' получена дважды. Импорт остановлен.');
      osSeen[category] = true;
      row[category + '_visits'] = siteCount_(os.metrics['ym:s:visits'], category + ' visits');
      row[category + '_users'] = siteCount_(os.metrics['ym:s:users'], category + ' users');
      row[category + '_new_users'] = siteCount_(os.metrics['ym:s:newUsers'], category + ' new users');
    } else {
      otherOs.push(String(os.dimension.name || os.dimension.id || 'unknown'));
    }
  }
  if (!osSeen.android || !osSeen.ios) {
    throw new Error('В отчёте по ОС не найдены однозначные группы Android и iOS. Проверьте список ОС вручную.');
  }
  if (otherOs.length) warnings.push('Мобильные ОС помимо Android/iOS: ' + otherOs.join(', '));
  if (row.android_users + row.ios_users > row.mobile_users) {
    warnings.push('Пользователи разных ОС могут пересекаться; их сумму нельзя считать уникальной мобильной аудиторией.');
  }
  if (row.mobile_users > row.users) {
    throw new Error('Мобильных пользователей больше общего итога: определения/фильтры нужно проверить.');
  }
  if (row.mobile_new_users > row.mobile_users || row.android_new_users > row.android_users || row.ios_new_users > row.ios_users) {
    throw new Error('Новых пользователей больше общего числа в одном из сегментов.');
  }

  var sourceReq = siteQuery_(startDate, endDate, ['ym:s:users'], ['ym:s:trafficSource'], '', 100);
  sourceReq.attribution = 'last';
  var sourceResponse = siteRequest_(sourceReq, token, runtime);
  var sourceData = siteReadGroups_(sourceResponse, sourceReq, nowMs);
  count++;
  var seenSources = {};
  var fields = ['organic', 'direct', 'referral', 'social'];
  for (i = 0; i < fields.length; i++) row['source_' + fields[i] + '_users'] = 0;
  for (i = 0; i < sourceData.length; i++) {
    var source = siteSourceKey_(sourceData[i].dimension);
    if (!source || fields.indexOf(source) < 0) continue;
    if (seenSources[source]) throw new Error('Категория источника ' + source + ' повторяется.');
    seenSources[source] = true;
    row['source_' + source + '_users'] = siteCount_(sourceData[i].metrics['ym:s:users'], source + ' users');
  }
  // Отсутствующий тип источника в ПОЛНОМ grouped-ответе означает 0. Пустой ответ как ошибка не принимается.
  if (sourceData.length === 0 && row.visits > 0) throw new Error('Отчёт источников пуст при ненулевых визитах.');

  var urls = siteUrlItems_();
  for (i = 0; i < urls.length; i++) {
    var item = urls[i];
    var filter = item.filterDimension + "=='" + siteFilterLiteral_(item.path) + "'";
    var urlReq = siteQuery_(startDate, endDate, ['ym:pv:pageviews'], [], filter, 1);
    var pageResponse = siteRequest_(urlReq, token, runtime);
    var pageTotals = siteReadTotals_(pageResponse, urlReq, nowMs);
    row[item.field] = siteCount_(pageTotals['ym:pv:pageviews'], item.field);
    count++;
  }
  row.traffic_attribution = 'last';
  row.sampled = false;
  row.sample_share = 1;
  row.publication = 'exact';
  return { exact: true, row: row, requests: count, warnings: warnings, otherMobileOs: otherOs };
}

function assertSiteFullWeek_(startDate, endDate, nowMs) {
  assertExplicitClosedPeriod(startDate, endDate, nowMs);
  var s = Date.parse(startDate + 'T00:00:00Z');
  var e = Date.parse(endDate + 'T00:00:00Z');
  if (!isFinite(s) || !isFinite(e) || new Date(s).getUTCDay() !== 1 || e - s !== 6 * 86400000) {
    throw new Error('Для недельного отчёта нужен период понедельник–воскресенье (7 календарных дней).');
  }
}

function siteQuery_(startDate, endDate, metrics, dimensions, filters, limit) {
  return {
    counterId: getMetrikaConfig().counterId,
    startDate: startDate, endDate: endDate,
    metrics: metrics, dimensions: dimensions,
    filters: filters || '',
    limit: limit || 1
  };
}

function siteFilterLiteral_(value) {
  if (/['\\]/.test(value)) throw new Error('Недопустимая кавычка или обратная косая черта в фильтре.');
  return value;
}

// Отдельный API-путь для фильтров/группировок. Существующий MetrikaClient.js не меняется.
function siteRequest_(query, token, runtime) {
  var conf = getMetrikaConfig();
  var pairs = [
    { key: 'ids', value: String(query.counterId) },
    { key: 'metrics', value: query.metrics.join(',') },
    { key: 'date1', value: query.startDate },
    { key: 'date2', value: query.endDate },
    { key: 'accuracy', value: 'full' },
    { key: 'timezone', value: conf.timezoneOffset },
    { key: 'limit', value: String(query.limit) },
    { key: 'offset', value: '1' }
  ];
  if (query.dimensions.length) pairs.push({ key: 'dimensions', value: query.dimensions.join(',') });
  if (query.filters) pairs.push({ key: 'filters', value: query.filters });
  if (query.attribution) pairs.push({ key: 'attribution', value: query.attribution });
  var url = conf.apiUrl + '?' + encodeQueryPairs_(pairs);
  var cleanToken = normalizeMetrikaToken_(token);
  if (url.indexOf(cleanToken) >= 0) throw new Error('Секрет попал в URL. Запрос отменён.');
  var slept = 0;
  for (var attempt = 1; attempt <= conf.maxAttempts; attempt++) {
    var response;
    try {
      response = runtime.fetch(url, {
        method: 'get',
        headers: { Authorization: 'OAuth ' + cleanToken, Accept: 'application/json' },
        muteHttpExceptions: true, followRedirects: false
      });
    } catch (error) {
      var delay = backoffDelayMs_(attempt, conf.maxSleepMs);
      if (attempt === conf.maxAttempts || slept + delay > conf.retryBudgetMs) {
        throw new Error('Сетевая ошибка Метрики: ' + sanitizeMetrikaText_(error && error.message, cleanToken));
      }
      runtime.sleep(delay);
      slept += delay;
      continue;
    }
    var status = response.getResponseCode();
    if (status === 200) return parseMetrikaBody_(response, cleanToken);
    if (status === 401 || status === 403) throw new Error(metrikaAuthFailureMessage_(status, conf.counterId));
    if (status >= 300 && status < 400) throw new Error('Перенаправление API запрещено (HTTP ' + status + ').');
    if (status === 429 || status >= 500) {
      var choice = retryDecision_(response, attempt, conf.maxAttempts, slept, conf.retryBudgetMs, runtime.now(), cleanToken);
      if (!choice.retry) throw new Error(choice.message);
      runtime.sleep(choice.delayMs);
      slept += choice.delayMs;
      continue;
    }
    throw new Error('Ошибка запроса Метрики HTTP ' + status + ': ' + safeMetrikaBodyMessage_(response, cleanToken));
  }
  throw new Error('Лимит попыток API исчерпан.');
}

function siteValidateResponse_(payload, query, nowMs, isGrouped) {
  if (!payload || !payload.query || !Array.isArray(payload.data) || !Array.isArray(payload.totals)) {
    throw new Error('Некорректная структура отчёта Метрики.');
  }
  var echo = payload.query;
  if (echo.date1 !== query.startDate || echo.date2 !== query.endDate ||
      echo.timezone !== getMetrikaConfig().timezoneOffset ||
      (echo.ids && !idsMatch_(echo.ids, query.counterId))) {
    throw new Error('Период, часовой пояс или ID счётчика ответа не совпадают с запросом.');
  }
  if (accuracyIsFull_(echo.accuracy) === false) throw new Error('Метрика не подтвердила accuracy=full.');
  if (payload.sampled !== false || payload.sample_share !== 1 || payload.total_rows_rounded !== false ||
      (typeof payload.sample_size === 'number' && typeof payload.sample_space === 'number' && payload.sample_size !== payload.sample_space)) {
    throw new Error('Ответ выборочный/усечённый или семплированный, записывать нельзя.');
  }
  if (dataLagIssue_(payload.data_lag, query.endDate, nowMs)) {
    throw new Error('Данные за период ещё не полностью доступны (data_lag).');
  }
  if (!sameStringSet_(echo.metrics || [], query.metrics) || hasDuplicateStrings_(echo.metrics || [])) {
    throw new Error('Метрики ответа отличаются от запроса.');
  }
  if (JSON.stringify(echo.dimensions || []) !== JSON.stringify(query.dimensions)) {
    throw new Error('Группировки ответа отличаются от запроса.');
  }
  if (String(echo.filters || '') !== String(query.filters || '')) {
    throw new Error('Фильтр ответа отличается от запроса.');
  }
  if (query.attribution && echo.attribution && echo.attribution !== query.attribution) {
    throw new Error('Атрибуция источников ответа отличается от last.');
  }
  if (!Number.isInteger(payload.total_rows) || payload.total_rows < 0) {
    throw new Error('total_rows невалиден.');
  }
  if (!isGrouped && payload.total_rows > 1) throw new Error('Без группировки должен быть один итог.');
  if (isGrouped && (payload.total_rows > query.limit || payload.data.length !== payload.total_rows)) {
    throw new Error('Отчёт с группировкой неполный; использовать суммы/частичные строки нельзя.');
  }
  if (!isGrouped && !(payload.data.length === 1 && payload.total_rows === 1) &&
      !(payload.data.length === 0 && payload.total_rows === 0)) {
    throw new Error('Итоговый отчёт содержит неожиданное число строк.');
  }
  if (payload.totals.length !== query.metrics.length) throw new Error('Длина totals не совпадает с метриками.');
  if (payload.contains_sensitive_data === true) {
    throw new Error('В отчёте присутствует ограниченное раскрытие данных. Не публикуем неполный срез.');
  }
}

function siteReadTotals_(payload, query, nowMs) {
  siteValidateResponse_(payload, query, nowMs, false);
  var out = mapValuesByMetricName(payload.query.metrics, payload.totals);
  if (payload.data.length === 1) {
    if (!isEmptyDimensions_(payload.data[0].dimensions) ||
        !metricVectorsAgree_(payload.data[0].metrics, payload.totals)) {
      throw new Error('Числа totals и data не совпадают.');
    }
  } else {
    // Нулевой итог считаем нулём только при явном подтверждении totals=0 и total_rows=0.
    for (var i = 0; i < payload.totals.length; i++) if (payload.totals[i] !== 0) {
      throw new Error('Пустой отчёт не подтверждает нулевое значение.');
    }
  }
  return out;
}

function siteReadGroups_(payload, query, nowMs) {
  siteValidateResponse_(payload, query, nowMs, true);
  if (query.dimensions.length !== 1) throw new Error('Поддерживается одна группировка.');
  var list = [];
  for (var i = 0; i < payload.data.length; i++) {
    var entry = payload.data[i];
    if (!entry || !Array.isArray(entry.dimensions) || entry.dimensions.length !== 1 ||
        !entry.dimensions[0] || !Array.isArray(entry.metrics) || entry.metrics.length !== query.metrics.length) {
      throw new Error('Строка сгруппированного отчёта повреждена.');
    }
    list.push({
      dimension: entry.dimensions[0],
      metrics: mapValuesByMetricName(payload.query.metrics, entry.metrics)
    });
  }
  return list;
}

function siteCount_(value, label) {
  if (typeof value !== 'number' || !isFinite(value) || value < 0 ||
      Math.floor(value) !== value || value > 9007199254740991) {
    throw new Error('Показатель ' + label + ' пуст/некорректен; подменять нулём нельзя.');
  }
  return value;
}

function siteMobileOs_(dimension) {
  var name = String(dimension.name || '').toLowerCase().trim();
  var id = String(dimension.id || '').toLowerCase().trim();
  if (name === 'android' || id === 'android') return 'android';
  if (name === 'ios' || id === 'ios') return 'ios';
  return '';
}
function siteSourceKey_(dimension) {
  var id = String(dimension.id || '').toLowerCase().trim();
  if (['organic','direct','referral','social'].indexOf(id) >= 0) return id;
  var name = String(dimension.name || '').toLowerCase().trim();
  var map = {
    'переходы из поисковых систем': 'organic',
    'прямые заходы': 'direct',
    'переходы по ссылкам на сайтах': 'referral',
    'переходы из социальных сетей': 'social'
  };
  return map[name] || '';
}
