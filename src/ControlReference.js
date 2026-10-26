// Эталон CSV за 12–18 октября 2026. Эти числа только для сверки.
// Их нельзя записывать вместо ответа API и нельзя использовать как значения отчёта.

function getControlReference() {
  return {
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    visits: 1515053,
    users: 461358,
    pageviews: 1842092,
    newVisitorsShare: 0.8478925259776573,
    bounceRate: 0.8653809470691785,
    pageDepth: 1.2158597752025837,
    averageVisitDurationDisplaySeconds: 86,
    visitsPerUser: 3.2838988377789047,
    // round(newVisitorsShare * users). В CSV не было отдельной колонки newUsers.
    newUsersEstimate: 391182,
    // Сумма дневных users. Это не недельные уникальные посетители.
    dailyUsersSumNotWeekly: 1019027
  };
}

function isControlPeriod(startDate, endDate) {
  var reference = getControlReference();
  return startDate === reference.startDate && endDate === reference.endDate;
}

function compareWithControl(row, reference) {
  var control = reference || getControlReference();
  if (!row) return [];
  return [
    compareExactCount_('visits', row.visits, control.visits),
    compareExactCount_('users', row.users, control.users),
    compareExactCount_('pageviews', row.pageviews, control.pageviews),
    compareRatio_('percent_new_visitors', row.percent_new_visitors, control.newVisitorsShare),
    compareRatio_('bounce_rate', row.bounce_rate, control.bounceRate),
    comparePageDepth_('page_depth', row.page_depth, control.pageDepth),
    compareDuration_('avg_visit_duration_seconds', row.avg_visit_duration_seconds, control.averageVisitDurationDisplaySeconds),
    compareRatio_('visits_per_user', row.visits_per_user, control.visitsPerUser),
    compareEstimate_('new_users', row.new_users, control.newUsersEstimate)
  ];
}

function compareExactCount_(field, actual, reference) {
  var item = comparisonItem_(field, actual, reference);
  if (typeof actual !== 'number') item.status = 'missing';
  else item.status = actual === reference ? 'match' : 'mismatch';
  return item;
}

function compareRatio_(field, actual, reference) {
  var item = comparisonItem_(field, actual, reference);
  if (typeof actual !== 'number') item.status = 'missing';
  else item.status = Math.abs(actual - reference) <= 1e-9 ? 'match' : 'mismatch';
  return item;
}

function comparePageDepth_(field, actual, reference) {
  var item = comparisonItem_(field, actual, reference);
  item.note = 'Допуск 1e-8: отличие около 5e-9 относится к точности представления числа. Эталон в строку не пишется.';
  if (typeof actual !== 'number') item.status = 'missing';
  else item.status = Math.abs(actual - reference) <= 1e-8 ? 'match' : 'mismatch';
  return item;
}

function compareDuration_(field, actual, displaySeconds) {
  var item = comparisonItem_(field, actual, displaySeconds);
  item.note = 'CSV показывает целые секунды. Ни округление, ни усечение не считаются доказанными. В строку пишется значение API.';
  if (typeof actual !== 'number') {
    item.status = 'missing';
    return item;
  }
  if (actual === displaySeconds) item.status = 'match';
  else if (Math.abs(actual - displaySeconds) < 1) item.status = 'display_uncertain';
  else item.status = 'mismatch';
  return item;
}

function compareEstimate_(field, actual, estimate) {
  var item = comparisonItem_(field, actual, estimate);
  item.note = 'Оценка из доли CSV, не колонка выгрузки. В строку не подставляется.';
  if (typeof actual !== 'number') item.status = 'missing';
  else item.status = actual === estimate ? 'estimate_match' : 'estimate_diff';
  return item;
}

function comparisonItem_(field, actual, reference) {
  var delta = null;
  if (typeof actual === 'number' && typeof reference === 'number') delta = actual - reference;
  return {
    field: field,
    actual: actual === undefined ? null : actual,
    reference: reference,
    delta: delta,
    status: 'mismatch',
    note: ''
  };
}
