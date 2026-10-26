const assert = require('node:assert/strict');
const test = require('node:test');
const { loadGas, httpResponse, createFetch, buildPayload, NOW, TOKEN } = require('./helpers');

function request(gas, token) {
  const config = gas.getMetrikaConfig();
  return {
    token: token == null ? TOKEN : token,
    counterId: config.counterId,
    startDate: config.controlStartDate,
    endDate: config.controlEndDate,
    metrics: gas.getRequestedMetricNames(),
    accuracy: 'low'
  };
}

test('URL запрашивает итог accuracy=full без группировок, фильтров и токена', function() {
  const gas = loadGas();
  const url = gas.buildMetrikaUrl(request(gas));
  const params = new URL(url).searchParams;
  assert.match(url, /^https:\/\/api-metrika\.yandex\.net\/stat\/v1\/data\?/);
  assert.equal(params.get('ids'), '176199');
  assert.equal(params.get('accuracy'), 'full');
  assert.equal(params.get('date1'), '2026-10-12');
  assert.equal(params.get('date2'), '2026-10-18');
  assert.equal(params.get('timezone'), '+03:00');
  assert.equal(params.get('limit'), '1');
  assert.equal(params.get('dimensions'), null);
  assert.equal(params.get('filters'), null);
  assert.equal(params.get('preset'), null);
  assert.equal(params.get('group'), null);
  assert.equal(url.includes(TOKEN), false);
  assert.equal(url.includes('radiorecord'), false);
  const metrics = params.get('metrics').split(',');
  assert.deepEqual(metrics, Array.from(gas.getRequestedMetricNames()));
  assert.throws(function() { gas.buildMetrikaUrl({ counterId: 176199 }); }, /date1 и date2/);
});

test('401 и 403 останавливают загрузку без повтора и без токена в тексте', function() {
  const gas = loadGas();
  for (const status of [401, 403]) {
    const fetch = createFetch([
      httpResponse(status, { message: 'denied ' + TOKEN }, { 'WWW-Authenticate': 'OAuth ' + TOKEN })
    ]);
    const sleeps = [];
    assert.throws(function() {
      gas.fetchMetrikaReport(request(gas), {
        fetch: fetch,
        sleep: function(ms) { sleeps.push(ms); },
        now: function() { return NOW; }
      });
    }, function(error) {
      assert.match(error.message, new RegExp('HTTP ' + status));
      assert.equal(error.message.includes(TOKEN), false);
      return true;
    });
    assert.equal(fetch.calls.length, 1);
    assert.equal(sleeps.length, 0);
    assert.equal(fetch.calls[0].options.followRedirects, false);
    assert.equal(fetch.calls[0].options.muteHttpExceptions, true);
    assert.equal(fetch.calls[0].options.headers.Authorization, 'OAuth ' + TOKEN);
    assert.equal(fetch.calls[0].url.includes(TOKEN), false);
  }
});

test('префикс OAuth в свойстве не дублируется в заголовке', function() {
  const gas = loadGas();
  const fetch = createFetch([httpResponse(200, buildPayload(gas))]);
  gas.fetchMetrikaReport(request(gas, 'OAuth ' + TOKEN), {
    fetch: fetch,
    sleep: function() {},
    now: function() { return NOW; }
  });
  assert.equal(fetch.calls[0].options.headers.Authorization, 'OAuth ' + TOKEN);
});

test('429 учитывает короткий Retry-After и не ждёт длинный', function() {
  const gas = loadGas();
  const payload = buildPayload(gas);
  const retry = createFetch([
    httpResponse(429, { message: TOKEN }, { 'Retry-After': '1' }),
    httpResponse(200, payload)
  ]);
  const sleeps = [];
  const parsed = gas.fetchMetrikaReport(request(gas), {
    fetch: retry,
    sleep: function(ms) { sleeps.push(ms); },
    now: function() { return NOW; }
  });
  assert.equal(parsed.sampled, false);
  assert.deepEqual(sleeps, [1000]);
  assert.equal(retry.calls.length, 2);

  const headerDate = new Date(NOW + 2000).toUTCString();
  const dated = createFetch([
    httpResponse(429, {}, { 'retry-after': headerDate }),
    httpResponse(200, payload)
  ]);
  const datedSleeps = [];
  gas.fetchMetrikaReport(request(gas), {
    fetch: dated,
    sleep: function(ms) { datedSleeps.push(ms); },
    now: function() { return NOW; }
  });
  assert.deepEqual(datedSleeps, [2000]);

  const longWait = createFetch([httpResponse(429, { message: 'quota ' + TOKEN }, { 'Retry-After': '30' })]);
  const longSleeps = [];
  assert.throws(function() {
    gas.fetchMetrikaReport(request(gas), {
      fetch: longWait,
      sleep: function(ms) { longSleeps.push(ms); },
      now: function() { return NOW; }
    });
  }, function(error) {
    assert.match(error.message, /429/);
    assert.match(error.message, /вручную/);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(longWait.calls.length, 1);
  assert.equal(longSleeps.length, 0);
});

test('временные 5xx повторяются ограниченно, 400 и редирект не повторяются', function() {
  const gas = loadGas();
  const payload = buildPayload(gas);
  const flaky = createFetch([
    httpResponse(503, { message: 'down ' + TOKEN }),
    httpResponse(500, {}),
    httpResponse(200, payload)
  ]);
  const sleeps = [];
  gas.fetchMetrikaReport(request(gas), {
    fetch: flaky,
    sleep: function(ms) { sleeps.push(ms); },
    now: function() { return NOW; }
  });
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(flaky.calls.length, 3);

  const always = createFetch([
    httpResponse(500, { message: TOKEN }),
    httpResponse(500, { message: TOKEN }),
    httpResponse(500, { message: TOKEN }),
    httpResponse(500, { message: TOKEN })
  ]);
  const alwaysSleeps = [];
  assert.throws(function() {
    gas.fetchMetrikaReport(request(gas), {
      fetch: always,
      sleep: function(ms) { alwaysSleeps.push(ms); },
      now: function() { return NOW; }
    });
  }, function(error) {
    assert.match(error.message, /500/);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(always.calls.length, 4);
  assert.deepEqual(alwaysSleeps, [1000, 2000, 4000]);

  const bad = createFetch([httpResponse(400, { message: 'bad ' + TOKEN })]);
  assert.throws(function() {
    gas.fetchMetrikaReport(request(gas), {
      fetch: bad,
      sleep: function() { throw new Error('sleep'); },
      now: function() { return NOW; }
    });
  }, function(error) {
    assert.match(error.message, /400/);
    assert.equal(error.message.includes(TOKEN), false);
    return true;
  });
  assert.equal(bad.calls.length, 1);

  const redirect = createFetch([httpResponse(302, 'go', { Location: 'https://example.test/' + TOKEN })]);
  assert.throws(function() {
    gas.fetchMetrikaReport(request(gas), {
      fetch: redirect,
      sleep: function() { throw new Error('sleep'); },
      now: function() { return NOW; }
    });
  }, /перенаправление/);
  assert.equal(redirect.calls.length, 1);
});

test('сетевая ошибка повторяется и не выводит токен', function() {
  const gas = loadGas();
  const fetch = createFetch([
    new Error('network ' + TOKEN),
    new Error('network ' + TOKEN),
    new Error('network ' + TOKEN),
    new Error('network ' + TOKEN)
  ]);
  const sleeps = [];
  assert.throws(function() {
    gas.fetchMetrikaReport(request(gas), {
      fetch: fetch,
      sleep: function(ms) { sleeps.push(ms); },
      now: function() { return NOW; }
    });
  }, function(error) {
    assert.equal(error.message.includes(TOKEN), false);
    assert.match(error.message, /не удалось связаться/i);
    return true;
  });
  assert.equal(fetch.calls.length, 4);
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
});
