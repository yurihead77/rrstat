const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const {
  loadGas, buildPayload, httpResponse, NOW, TOKEN, SHEET_ID,
  createRuntime, createMemorySpreadsheet
} = require(fs.existsSync(path.join(__dirname, 'helpers.js')) ? './helpers.js' : '../../metrika-review/tests/helpers.js');

function gas() {
  const g = loadGas();
  for (const name of ['SiteMetrics.js','SiteWriter.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),g,{filename:name});
  }
  return g;
}

function asReport(query, rows, metricsTotals) {
  const data = rows.map(d => ({dimensions: d.dims || [],metrics: d.values}));
  return {
    query: {
      ids: [176199], metrics: (query.get('metrics')||'').split(','),
      dimensions: (query.get('dimensions')||'').split(',').filter(Boolean),
      filters: query.get('filters')||'',
      date1: query.get('date1'), date2: query.get('date2'),timezone:'+03:00',accuracy:'full',
      attribution: query.get('attribution')||undefined
    },
    data,total_rows:data.length,total_rows_rounded:false,
    sampled:false,sample_share:1,sample_size:758512,sample_space:758512,
    data_lag:0,contains_sensitive_data:false,
    totals:metricsTotals
  };
}

function makeFetch(g, opts={}) {
  let calls=[];
  const fn = (url, options) => {
    calls.push({url,options});
    const p = new URL(url).searchParams;
    const names = p.get('metrics').split(',');
    const dims = p.get('dimensions')||'';
    const filter = p.get('filters')||'';
    let payload;
    if (names.length === 8 && !filter) {
      payload = buildPayload(g);
      payload.query.date1 = p.get('date1'); payload.query.date2 = p.get('date2');
      if(opts.changePrior && p.get('date1')==='2026-10-05') {
        payload.totals[0] = 400000;
        payload.data[0].metrics = payload.totals.slice();
      }
    } else if (dims === 'ym:s:operatingSystemRoot') {
      payload=asReport(p,[
        {dims:[{id:'android',name:'Android'}],values:[400000,280000,270000]},
        {dims:[{id:'ios',name:'iOS'}],values:[200000,110000,100000]}
      ],[600000,380000,370000]);
    } else if (dims === 'ym:s:trafficSource') {
      payload=asReport(p,[
        {dims:[{id:'organic',name:'Переходы из поисковых систем'}],values:[310000]},
        {dims:[{id:'direct',name:'Прямые заходы'}],values:[110000]},
        {dims:[{id:'referral',name:'Переходы по ссылкам на сайтах'}],values:[10000]},
        {dims:[{id:'social',name:'Переходы из социальных сетей'}],values:[2000]}
      ],[432000]);
    } else if (filter.includes('deviceCategory') && names[0]==='ym:s:visits') {
      payload=asReport(p,[{values:[600000,390000,375000]}],[600000,390000,375000]);
    } else if (names[0]==='ym:pv:pageviews') {
      payload=asReport(p,[{values:[101]}],[101]);
    } else throw new Error('Unexpected request '+url);
    if(opts.failUrl && filter.includes('URLPath')) {
      payload.sampled=true; payload.sample_share=0.5;
    }
    if(opts.failFilter && filter.includes('URLPath')) payload.query.filters='different';
    return httpResponse(200,payload);
  };
  fn.calls=calls;
  return fn;
}

function spyRuntime(fetch, opts={}) {
  const tracker=[];
  const book=createMemorySpreadsheet();
  const rt=createRuntime({
    fetch,
    spreadsheet:book,
    properties:opts.properties || {METRIKA_TOKEN:TOKEN,TARGET_SPREADSHEET_ID:SHEET_ID},
    openById:id=>{tracker.push('open');book.openedIds.push(id);return book;},
    getLock:()=>({waitLock:()=>tracker.push('lock'),releaseLock:()=>tracker.push('release')})
  });
  rt.deps.flush=()=>{tracker.push('flush');if(opts.flushError)throw new Error('flush error');};
  rt.tracker=tracker;
  return rt;
}

test('preview собирает 14 проверенных API-ответов и не открывает Sheets / flush',()=>{
  const g=gas();const fetch=makeFetch(g);
  const rt=spyRuntime(fetch);
  rt.deps.openById=()=>{throw Error('preview opened sheet');};
  rt.deps.getLock=()=>{throw Error('preview locked');};
  rt.deps.flush=()=>{throw Error('preview flushed');};
  const preview=g.previewSiteControlWeek(rt.deps);
  assert.equal(preview.exact,true);
  assert.equal(preview.requests,14);
  assert.equal(fetch.calls.length,14);
  assert.equal(preview.row.users,461358);
  assert.equal(preview.row.mobile_users,390000);
  assert.equal(preview.row.android_users,280000);
  assert.equal(preview.row.ios_users,110000);
  assert.equal(preview.row.source_organic_users,310000);
  assert.equal(preview.row.pv_home,101);
  assert.equal(preview.row.pv_radio_stations_rr,101);
  assert.equal(rt.tracker.length,0);
  assert.equal(fetch.calls.some(x=>x.url.includes(TOKEN)),false);
  assert.equal(fetch.calls.every(x=>x.options.headers.Authorization==='OAuth '+TOKEN),true);
  assert.ok(fetch.calls.some(x=>decodeURIComponent(x.url).includes('ym:pv:URLPathFull')));
});

test('повторный импорт обновляет строку и view, flush до release',()=>{
  const g=gas();const fetch=makeFetch(g);
  const rt=spyRuntime(fetch);
  const a=g.importSiteControlWeek(rt.deps);
  assert.equal(a.writeResult.action,'append');
  assert.equal(a.writeResult.weeks,1);
  assert.deepEqual(rt.tracker.slice(-2),['flush','release']);
  const store=rt.spreadsheet.getSheetByName('metrika_site_weekly');
  const view=rt.spreadsheet.getSheetByName('site_report_preview');
  assert.equal(store.getLastRow(),2);
  assert.equal(view.getRange(52,1,1,1).getValues()[0][0],g.SITE_VIEW_MARKER);
  assert.equal(view.getRange(3,2,1,1).getValues()[0][0],461358);
  assert.equal(view.getRange(4,2,1,1).getValues()[0][0],391182);
  assert.equal(view.getRange(9,2,1,1).getValues()[0][0],86.4/86400);
  assert.equal(view.getRange(12,2,1,1).getValues()[0][0],280000/(280000+110000));
  assert.equal(view.getRange(34,2,1,1).getValues()[0][0],101);
  assert.equal(view.getRange(50,3,1,1).getValues()[0][0],110000/390000);
  const b=g.importSiteControlWeek(rt.deps);
  assert.equal(b.writeResult.action,'update');
  assert.equal(store.getLastRow(),2);
  assert.equal(rt.spreadsheet.openedIds.includes(g.getMetrikaConfig().forbiddenSpreadsheetId),false);
});

test('две соседние недели формируют Δ, разрыв недели Δ не заполняет',()=>{
  const g=gas();const fetch=makeFetch(g,{changePrior:true});const rt=spyRuntime(fetch);
  g.importSiteControlWeek(rt.deps);
  g.importSiteWeek('2026-10-05','2026-10-11',rt.deps);
  const view=rt.spreadsheet.getSheetByName('site_report_preview');
  assert.equal(view.getRange(3,2,1,1).getValues()[0][0],461358);
  assert.equal(view.getRange(3,4,1,1).getValues()[0][0],400000);
  assert.ok(Math.abs(view.getRange(3,3,1,1).getValues()[0][0] - (461358/400000-1))<1e-12);
  const gap=g.siteBuildView_([
    {start_date:'2026-10-12',end_date:'2026-10-18',users:10,visits:20,android_users:4,ios_users:2,mobile_users:6},
    {start_date:'2026-09-28',end_date:'2026-10-04',users:5,visits:10,android_users:2,ios_users:1,mobile_users:3}
  ]);
  assert.equal(gap[2][2],'');
});

test('любая неполнота URL отчета или несогласованный фильтр блокирует import до открытия Sheets',()=>{
  const g=gas();
  for (const opts of [{failUrl:true},{failFilter:true}]) {
    const rt=spyRuntime(makeFetch(g,opts));
    assert.throws(()=>g.importSiteControlWeek(rt.deps),/Ответ выборочный|Фильтр ответа/);
    assert.equal(rt.tracker.length,0);
    assert.equal(rt.spreadsheet.getSheetByName('metrika_site_weekly'),null);
  }
});

test('запрет рабочей таблицы проверяется до первого сетевого запроса',()=>{
  const g=gas();
  const forbidden=g.getMetrikaConfig().forbiddenSpreadsheetId;
  const rt=spyRuntime(()=>{throw new Error('fetch forbidden');},{properties:{METRIKA_TOKEN:TOKEN,TARGET_SPREADSHEET_ID:forbidden}});
  assert.throws(()=>g.importSiteControlWeek(rt.deps),/запрещена/);
  assert.equal(rt.tracker.length,0);
});

test('ошибка flush освобождает lock; view/данные могут сохраниться, rollback не обещаем',()=>{
  const g=gas();const rt=spyRuntime(makeFetch(g),{flushError:true});
  assert.throws(()=>g.importSiteControlWeek(rt.deps),/flush error/);
  assert.deepEqual(rt.tracker.slice(-2),['flush','release']);
  assert.ok(rt.spreadsheet.getSheetByName('metrika_site_weekly'));
});

test('чужая вкладка site_report_preview не перезаписывается',()=>{
  const g=gas();
  const book=createMemorySpreadsheet({sheets:[{name:'site_report_preview',rows:[['пользовательская таблица']]}]});
  const rt=createRuntime({fetch:makeFetch(g),spreadsheet:book});
  rt.deps.flush=()=>{};
  assert.throws(()=>g.importSiteControlWeek(rt.deps),/не принадлежит/);
  assert.equal(book.getSheetByName('site_report_preview').getRange(1,1,1,1).getValues()[0][0], 'пользовательская таблица');
  assert.equal(book.getSheetByName('metrika_site_weekly'),null);
});

test('защита периода: только завершенная календарная неделя',()=>{
  const g=gas();const rt=spyRuntime(makeFetch(g));
  assert.throws(()=>g.previewSiteWeek('2026-10-13','2026-10-18',rt.deps),/понедельник/);
  assert.throws(()=>g.previewSiteWeek('2026-10-19','2026-10-25',rt.deps),/ещё не завершён/);
  assert.equal(rt.tracker.length,0);
});
