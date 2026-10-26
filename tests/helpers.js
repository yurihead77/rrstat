const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const FILES = [
  'Config.js',
  'ControlReference.js',
  'Normalize.js',
  'Validate.js',
  'MetrikaClient.js',
  'SheetWriter.js',
  'Main.js'
];

const NOW = Date.parse('2026-10-25T12:00:00+03:00');
const TOKEN = 'secret-token-value';
const SHEET_ID = 'test-spreadsheet-id-0001';

function loadGas() {
  const sandbox = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    RegExp,
    isFinite,
    isNaN,
    encodeURIComponent,
    decodeURIComponent
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of FILES) {
    const code = fs.readFileSync(path.join(SRC, file), 'utf8');
    vm.runInContext(code, sandbox, { filename: file });
  }
  if (typeof sandbox.previewControlWeek !== 'function') {
    throw new Error('Функции Apps Script не загрузились');
  }
  return sandbox;
}

function readSources() {
  return FILES.map(function(file) {
    return {
      file: file,
      text: fs.readFileSync(path.join(SRC, file), 'utf8')
    };
  });
}

function httpResponse(status, body, headers) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    getResponseCode: function() { return status; },
    getAllHeaders: function() { return headers || {}; },
    getContentText: function() { return text; }
  };
}

function createFetch(sequence) {
  const calls = [];
  const fn = function(url, options) {
    calls.push({ url: url, options: options });
    const next = sequence[Math.min(calls.length - 1, sequence.length - 1)];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    return next;
  };
  fn.calls = calls;
  return fn;
}

function buildPayload(gas, mutate) {
  const config = gas.getMetrikaConfig();
  const ref = gas.getControlReference();
  const names = gas.getRequestedMetricNames();
  const byName = {
    'ym:s:users': ref.users,
    'ym:s:newUsers': ref.newUsersEstimate,
    'ym:s:visits': ref.visits,
    'ym:s:pageviews': ref.pageviews,
    'ym:s:percentNewVisitors': ref.newVisitorsShare * 100,
    'ym:s:bounceRate': ref.bounceRate * 100,
    'ym:s:pageDepth': ref.pageDepth,
    'ym:s:avgVisitDurationSeconds': 86.4
  };
  const totals = names.map(function(name) { return byName[name]; });
  const payload = {
    query: {
      ids: [config.counterId],
      dimensions: [],
      metrics: names.slice(),
      date1: config.controlStartDate,
      date2: config.controlEndDate,
      timezone: config.timezoneOffset,
      accuracy: 'full',
      limit: 1,
      offset: 1
    },
    data: [{ dimensions: [], metrics: totals.slice() }],
    total_rows: 1,
    total_rows_rounded: false,
    sampled: false,
    contains_sensitive_data: false,
    sample_share: 1,
    sample_size: ref.visits,
    sample_space: ref.visits,
    data_lag: 0,
    totals: totals.slice()
  };
  if (mutate) mutate(payload, byName);
  return payload;
}

function syncPayloadRow(payload) {
  payload.data[0].metrics = payload.totals.slice();
}

function expectedRequest(gas, nowMs, startDate, endDate) {
  const config = gas.getMetrikaConfig();
  return {
    counterId: config.counterId,
    startDate: startDate || config.controlStartDate,
    endDate: endDate || config.controlEndDate,
    metrics: gas.getRequestedMetricNames(),
    timezone: config.timezone,
    timezoneOffset: config.timezoneOffset,
    definitionVersion: config.definitionVersion,
    nowMs: nowMs == null ? NOW : nowMs
  };
}

function columnIndex(gas, name) {
  return gas.getSheetColumns().indexOf(name);
}

function createMemorySpreadsheet(options) {
  const sheets = {};
  const spreadsheet = {
    failDataWrite: false,
    _insertCount: 0,
    openedIds: [],
    getSheetByName: function(name) { return sheets[name] || null; },
    insertSheet: function(name) {
      if (sheets[name]) throw new Error('sheet exists: ' + name);
      spreadsheet._insertCount += 1;
      sheets[name] = createSheet(spreadsheet, name);
      return sheets[name];
    },
    getCharts: function() { throw new Error('графики изменять нельзя'); },
    clear: function() { throw new Error('очистка книги запрещена'); },
    deleteSheet: function() { throw new Error('удаление листа запрещено'); }
  };
  const initial = (options && options.sheets) || [];
  for (let i = 0; i < initial.length; i++) {
    sheets[initial[i].name] = createSheet(spreadsheet, initial[i].name, initial[i]);
  }
  spreadsheet._sheets = sheets;
  return spreadsheet;
}

function createSheet(spreadsheet, name, initial) {
  const rows = ((initial && initial.rows) || []).map(function(row) { return row.slice(); });
  const formulas = ((initial && initial.formulas) || []).map(function(row) { return row.slice(); });
  const sheet = {
    _rows: rows,
    _formulas: formulas,
    _setCalls: [],
    _formats: [],
    getName: function() { return name; },
    getLastRow: function() {
      for (let r = rows.length - 1; r >= 0; r--) {
        const line = rows[r] || [];
        for (let c = 0; c < line.length; c++) {
          if (line[c] !== '' && line[c] != null) return r + 1;
        }
      }
      return 0;
    },
    getRange: function(row, column, numRows, numColumns) {
      const height = numRows == null ? 1 : numRows;
      const width = numColumns == null ? 1 : numColumns;
      const startRow = row - 1;
      const startCol = column - 1;
      return {
        getValues: function() {
          const out = [];
          for (let r = 0; r < height; r++) {
            const source = rows[startRow + r] || [];
            const line = [];
            for (let c = 0; c < width; c++) {
              const value = source[startCol + c];
              line.push(value == null ? '' : value);
            }
            out.push(line);
          }
          return out;
        },
        getFormulas: function() {
          const out = [];
          for (let r = 0; r < height; r++) {
            const source = formulas[startRow + r] || [];
            const line = [];
            for (let c = 0; c < width; c++) line.push(source[startCol + c] || '');
            out.push(line);
          }
          return out;
        },
        setValues: function(values) {
          if (spreadsheet.failDataWrite && row > 1) throw new Error('setValues failed');
          sheet._setCalls.push({
            row: row,
            column: column,
            values: JSON.parse(JSON.stringify(values))
          });
          for (let r = 0; r < values.length; r++) {
            if (!rows[startRow + r]) rows[startRow + r] = [];
            if (!formulas[startRow + r]) formulas[startRow + r] = [];
            for (let c = 0; c < values[r].length; c++) {
              rows[startRow + r][startCol + c] = values[r][c];
              formulas[startRow + r][startCol + c] = '';
            }
          }
        },
        setNumberFormats: function(formatGrid) {
          sheet._formats.push({ row: row, column: column, formatGrid: formatGrid });
        }
      };
    },
    clear: function() { throw new Error('очистка листа запрещена'); },
    deleteRow: function() { throw new Error('удаление строки запрещено'); },
    deleteRows: function() { throw new Error('удаление строк запрещено'); }
  };
  return sheet;
}

function sheetSnapshot(sheet) {
  return JSON.stringify({ rows: sheet._rows, formulas: sheet._formulas });
}

function createRuntime(options) {
  const logs = [];
  const sleeps = [];
  const lockState = { waits: 0, releases: 0, held: false, waitMs: null };
  const lock = {
    waitLock: function(ms) {
      if (options && options.lockError) throw new Error(options.lockError);
      lockState.waits += 1;
      lockState.waitMs = ms;
      lockState.held = true;
    },
    releaseLock: function() {
      lockState.held = false;
      lockState.releases += 1;
    }
  };
  const spreadsheet = options && Object.prototype.hasOwnProperty.call(options, 'spreadsheet')
    ? options.spreadsheet
    : createMemorySpreadsheet({
      sheets: [{ name: 'Лист1', rows: [['заголовок'], [2]], formulas: [[''], ['=1+1']] }]
    });
  let ticks = 0;
  const deps = {
    properties: (options && options.properties) || {
      METRIKA_TOKEN: TOKEN,
      TARGET_SPREADSHEET_ID: SHEET_ID
    },
    fetch: options && options.fetch,
    sleep: function(ms) { sleeps.push(ms); },
    now: (options && options.now) || function() { return NOW + ticks++ * 1000; },
    log: function(message) { logs.push(String(message)); },
    openById: (options && options.openById) || function(id) {
      if (!spreadsheet) throw new Error('openById не ожидался: ' + id);
      spreadsheet.openedIds.push(id);
      return spreadsheet;
    },
    getLock: (options && options.getLock) || function() { return lock; },
    flush: (options && options.flush) || function() {
      if (options && options.flushError) throw new Error(options.flushError);
    }
  };
  return { deps: deps, logs: logs, sleeps: sleeps, lockState: lockState, spreadsheet: spreadsheet };
}

module.exports = {
  SRC,
  FILES,
  NOW,
  TOKEN,
  SHEET_ID,
  loadGas,
  readSources,
  httpResponse,
  createFetch,
  buildPayload,
  syncPayloadRow,
  expectedRequest,
  columnIndex,
  createMemorySpreadsheet,
  sheetSnapshot,
  createRuntime
};
