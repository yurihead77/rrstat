// Клиент Reporting API. Токен передаётся только заголовком Authorization и в журнал не попадает.

function buildMetrikaUrl(request) {
  var config = getMetrikaConfig();
  if (!request || !request.startDate || !request.endDate) {
    throw new Error('date1 и date2 обязательны. Период по умолчанию API не используется.');
  }
  if (!request.counterId) throw new Error('Не задан счётчик Метрики.');
  var names = request.metrics && request.metrics.length ? request.metrics : getRequestedMetricNames();
  var pairs = [
    { key: 'ids', value: String(request.counterId) },
    { key: 'metrics', value: names.join(',') },
    { key: 'date1', value: request.startDate },
    { key: 'date2', value: request.endDate },
    { key: 'accuracy', value: 'full' },
    { key: 'timezone', value: config.timezoneOffset },
    { key: 'limit', value: '1' }
  ];
  return config.apiUrl + '?' + encodeQueryPairs_(pairs);
}

function fetchMetrikaReport(request, deps) {
  var config = getMetrikaConfig();
  var token = normalizeMetrikaToken_(request && request.token);
  if (!token) {
    throw new Error(
      'METRIKA_TOKEN не найден в Script Properties. Добавьте токен вручную в редакторе Apps Script. ' +
      'Не отправляйте токен в чат и не записывайте его в файлы проекта.'
    );
  }
  var url = buildMetrikaUrl(request);
  if (url.indexOf(token) !== -1) throw new Error('Токен попал в URL. Запрос отменён.');
  var attempts = config.maxAttempts;
  var budget = config.retryBudgetMs;
  var slept = 0;
  var lastStatus = 0;

  for (var attempt = 1; attempt <= attempts; attempt++) {
    var response;
    try {
      response = deps.fetch(url, {
        method: 'get',
        headers: {
          Authorization: 'OAuth ' + token,
          Accept: 'application/json'
        },
        muteHttpExceptions: true,
        followRedirects: false
      });
    } catch (networkError) {
      var networkDelay = backoffDelayMs_(attempt, config.maxSleepMs);
      if (attempt === attempts || slept + networkDelay > budget) {
        throw new Error(
          'Не удалось связаться с API Метрики после ' + attempt + ' попыток. ' +
          sanitizeMetrikaText_(networkError && networkError.message, token)
        );
      }
      deps.sleep(networkDelay);
      slept += networkDelay;
      continue;
    }

    var status = response.getResponseCode();
    lastStatus = status;
    if (status === 200) return parseMetrikaBody_(response, token);
    if (status === 401 || status === 403) throw new Error(metrikaAuthFailureMessage_(status, config.counterId));
    if (status >= 300 && status < 400) {
      throw new Error(
        'API Метрики вернуло перенаправление HTTP ' + status +
        '. Ответ отклонён, токен повторно не отправляется.'
      );
    }
    if (status === 429 || status >= 500) {
      var decision = retryDecision_(response, attempt, attempts, slept, budget, deps.now ? deps.now() : Date.now(), token);
      if (!decision.retry) throw new Error(decision.message);
      deps.sleep(decision.delayMs);
      slept += decision.delayMs;
      continue;
    }
    throw new Error(
      'API Метрики вернуло HTTP ' + status + '. ' + safeMetrikaBodyMessage_(response, token) + ' Повтор не выполняется.'
    );
  }

  throw new Error('Запрос к Метрике остановлен после ' + attempts + ' попыток (последний HTTP ' + lastStatus + ').');
}

function normalizeMetrikaToken_(token) {
  var text = token == null ? '' : String(token).trim();
  if (/^OAuth\s+/i.test(text)) text = text.replace(/^OAuth\s+/i, '').trim();
  return text;
}

function encodeQueryPairs_(pairs) {
  var parts = [];
  for (var i = 0; i < pairs.length; i++) {
    parts.push(encodeURIComponent(pairs[i].key) + '=' + encodeURIComponent(pairs[i].value));
  }
  return parts.join('&');
}

function retryDecision_(response, attempt, attempts, slept, budget, nowMs, token) {
  var status = response.getResponseCode();
  if (attempt >= attempts) {
    return {
      retry: false,
      message: 'HTTP ' + status + '. Повторы исчерпаны. Запустите функцию позже вручную. Данные не записаны. ' +
        safeMetrikaBodyMessage_(response, token)
    };
  }
  var config = getMetrikaConfig();
  var retryAfter = parseRetryAfterMs_(headerValue_(response.getAllHeaders(), 'retry-after'), nowMs);
  if (retryAfter !== null && retryAfter > config.maxSleepMs) {
    return {
      retry: false,
      message: 'HTTP ' + status + '. Retry-After превышает ' + (config.maxSleepMs / 1000) +
        ' с. Ожидание внутри Apps Script не выполняется. Запустите функцию позже вручную. Данные не записаны.'
    };
  }
  var delay = retryAfter !== null ? retryAfter : backoffDelayMs_(attempt, config.maxSleepMs);
  if (slept + delay > budget) {
    return {
      retry: false,
      message: 'HTTP ' + status + '. Лимит ожидания повторов исчерпан. Запустите функцию позже вручную. Данные не записаны.'
    };
  }
  return { retry: true, delayMs: delay };
}

function backoffDelayMs_(attempt, maxSleepMs) {
  var shift = attempt - 1;
  if (shift < 0) shift = 0;
  var delay = 1000 * Math.pow(2, shift);
  if (delay > maxSleepMs) delay = maxSleepMs;
  return delay;
}

function parseRetryAfterMs_(raw, nowMs) {
  if (raw == null || raw === '') return null;
  var text = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(text)) {
    var seconds = Number(text);
    if (!isFinite(seconds) || seconds < 0) return null;
    return Math.round(seconds * 1000);
  }
  var when = Date.parse(text);
  if (!isFinite(when)) return null;
  return Math.max(0, when - nowMs);
}

function headerValue_(headers, name) {
  if (!headers) return '';
  var keys = Object.keys(headers);
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).toLowerCase() !== name) continue;
    var value = headers[keys[i]];
    if (Array.isArray(value)) return value.length ? String(value[0]) : '';
    return value == null ? '' : String(value);
  }
  return '';
}

function parseMetrikaBody_(response, token) {
  var text = response.getContentText();
  var parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error('Ответ Метрики не является JSON. Данные не приняты.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Ответ Метрики не является JSON-объектом. Данные не приняты.');
  }
  if (parsed.errors || (parsed.code && parsed.code !== 200)) {
    throw new Error('API Метрики вернуло ошибку в теле ответа. ' + safeParsedMetrikaMessage_(parsed, token));
  }
  return parsed;
}

function safeMetrikaBodyMessage_(response, token) {
  try {
    return safeParsedMetrikaMessage_(JSON.parse(response.getContentText()), token);
  } catch (error) {
    return 'Текст ответа скрыт.';
  }
}

function safeParsedMetrikaMessage_(parsed, token) {
  var message = '';
  if (parsed && typeof parsed.message === 'string') message = parsed.message;
  else if (parsed && parsed.errors && parsed.errors[0] && typeof parsed.errors[0].message === 'string') {
    message = parsed.errors[0].message;
  }
  message = sanitizeMetrikaText_(message, token);
  return message ? message : 'Текст ответа скрыт.';
}

function metrikaAuthFailureMessage_(status, counterId) {
  if (status === 401) {
    return 'Яндекс Метрика отклонила запрос (HTTP 401). Проверьте свойство METRIKA_TOKEN в Script Properties. ' +
      'Токен в лог не выводится. Загрузка остановлена.';
  }
  return 'Недостаточно прав для счётчика ' + counterId +
    ' (HTTP 403). Нужен доступ на чтение metrika:read. Загрузка остановлена.';
}

function sanitizeMetrikaText_(text, secret) {
  var out = String(text || '');
  if (secret) out = out.split(secret).join('[redacted]');
  out = out.replace(/OAuth\s+\S+/gi, 'OAuth [redacted]');
  out = out.replace(/access_token=\S+/gi, 'access_token=[redacted]');
  if (out.length > 300) out = out.substring(0, 300);
  return out;
}
