/* Evenself: analytics engine.
   Turns one data input (the fictional demo persona, or the visitor's own entries converted by store.toInput)
   into a "twin model": every number, score and insight on the page and every chat answer comes from here.
   Sparse data is expected: any metric that can't be computed is null, and scores are averaged only over
   the parts that have data (null when there isn't enough). */
(function () {
  'use strict';

  const DAY = 86400000;
  const toDate = (s) => new Date(s + 'T12:00:00');
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);
  const ok = (x) => x !== null && x !== undefined && Number.isFinite(x);
  /** mean that ignores missing values; null when nothing to average */
  const mean = (a) => { const v = a.filter(ok); return v.length ? sum(v) / v.length : null; };
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const monthKey = (s) => s.slice(0, 7);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let refYear = String(new Date().getFullYear());
  const monthLabel = (k) => MONTHS[+k.slice(5, 7) - 1] + (k.slice(0, 4) !== refYear ? ' ' + k.slice(2, 4) : '');
  const monthName = (k) => ['January','February','March','April','May','June','July','August','September','October','November','December'][+k.slice(5, 7) - 1];
  const addMonths = (k, n) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const daysInMonth = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();
  /** weighted score over the components that exist: parts = [[weight, value0to1 | null], ...] */
  const weighted = (parts, minParts = 1) => {
    const have = parts.filter(([, v]) => ok(v));
    if (have.length < minParts) return null;
    const w = sum(have.map(([x]) => x));
    return Math.round(100 * sum(have.map(([x, v]) => x * v)) / w);
  };

  const NON_SPEND = new Set(['Savings transfers', 'Debt payments', 'Income']);
  const ESSENTIALS = ['Housing', 'Utilities', 'Groceries', 'Transport', 'Subscriptions', 'Pets', 'Health & Fitness', 'Insurance'];

  function finance(p, asOf) {
    const f = p.finance;
    const txs = f.transactions || [];
    const cur = monthKey(asOf);
    const last = addMonths(cur, -1);
    const prev = addMonths(cur, -2);
    const first = txs.length ? txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date) : asOf;
    const startK = f.startMonth && f.startMonth < monthKey(first) ? f.startMonth : monthKey(first);
    const months = [];
    for (let k = startK; k <= cur; k = addMonths(k, 1)) months.push(k);
    const fullMonths = months.filter((m) => m !== cur);

    const budgetMap = f.monthlyBudget || {};
    const cats = Object.keys(budgetMap).slice();
    txs.forEach((t) => { if (!NON_SPEND.has(t.category) && !cats.includes(t.category)) cats.push(t.category); });
    const byMonthCat = {};
    const debtPay = {}, savedXfer = {}, income = {};
    months.forEach((m) => { byMonthCat[m] = Object.fromEntries(cats.map((c) => [c, 0])); debtPay[m] = 0; savedXfer[m] = 0; income[m] = 0; });
    txs.forEach((t) => {
      const m = monthKey(t.date);
      if (!byMonthCat[m]) return;
      if (t.category === 'Debt payments') debtPay[m] += t.amount;
      else if (t.category === 'Savings transfers') savedXfer[m] += t.amount;
      else byMonthCat[m][t.category] = (byMonthCat[m][t.category] || 0) + t.amount;
    });
    (f.income || []).forEach((i) => { const m = monthKey(i.date); if (m in income) income[m] += i.amount; });
    const spend = (m) => sum(Object.values(byMonthCat[m] || {}));
    const tracked = (m) => months.includes(m);
    const userTx = f.userTxCount !== undefined ? f.userTxCount : txs.length;

    // same-point-in-month comparison (e.g. Oct 1–9 vs Sep 1–9)
    const dayOfMonth = +asOf.slice(8, 10);
    const mtd = (m, cat) => sum(txs.filter((t) => monthKey(t.date) === m && +t.date.slice(8, 10) <= dayOfMonth && (cat ? t.category === cat : !NON_SPEND.has(t.category))).map((t) => t.amount));

    const savingsRate = (m) => (income[m] ? (income[m] - spend(m) - debtPay[m]) / income[m] : null);
    const hasLast = tracked(last) && spend(last) > 0;
    const hasPrev = tracked(prev) && spend(prev) > 0;
    const lastSavingsRate = hasLast ? savingsRate(last) : null;
    const avgSavingsRate3 = mean(fullMonths.slice(-3).filter((m) => spend(m) > 0).map(savingsRate));
    // projection for the current month: recurring items already counted in full + day-to-day spending scaled to a full month
    const curAuto = sum(txs.filter((t) => monthKey(t.date) === cur && t.auto && !NON_SPEND.has(t.category)).map((t) => t.amount));
    const curVar = spend(cur) - curAuto;
    const projSpend = curAuto + (dayOfMonth ? curVar / dayOfMonth * daysInMonth(cur) : 0);
    const projDebt = debtPay[cur] || 0;
    const projRate = income[cur] && spend(cur) > 0 ? (income[cur] - projSpend - projDebt) / income[cur] : null;
    const rateNow = ok(lastSavingsRate) ? lastSavingsRate : projRate;
    const rateBasis = ok(lastSavingsRate) ? 'last' : ok(projRate) ? 'projected' : null;
    const surplusFull = mean(fullMonths.slice(-3).filter((m) => spend(m) > 0 && income[m]).map((m) => income[m] - spend(m) - debtPay[m] - savedXfer[m]));
    const surplus3 = ok(surplusFull) ? surplusFull : income[cur] && spend(cur) > 0 ? income[cur] - projSpend - projDebt - (savedXfer[cur] || 0) : null;

    const accounts = f.accounts || [], debts = f.debts || [];
    const acct = (type) => accounts.filter((a) => a.type === type);
    const checking = acct('checking').length ? sum(acct('checking').map((a) => a.balance)) : null;
    const efAccts = accounts.filter((a) => a.type === 'emergency' || /emergency/i.test(a.name));
    const savingsAccts = accounts.filter((a) => a.type === 'savings');
    const efund = efAccts.length ? sum(efAccts.map((a) => a.balance)) : savingsAccts.length && !accounts.some((a) => /trip|vacation/i.test(a.name)) ? sum(savingsAccts.map((a) => a.balance)) : null;
    const tripFund = accounts.find((a) => /trip/i.test(a.name));
    const assets = sum(accounts.map((a) => a.balance));
    const liabilities = sum(debts.map((d) => d.balance));
    const essFull = mean(fullMonths.slice(-3).filter((m) => spend(m) > 0).map((m) => sum(ESSENTIALS.map((c) => byMonthCat[m][c] || 0)) + debtPay[m]));
    const essentials = ok(essFull) && essFull > 0 ? essFull : f.fixedMonthly ? f.fixedMonthly : null;
    const efundMonths = ok(efund) && essentials ? efund / essentials : null;
    const cc = debts.find((d) => d.limit) || null;
    const utilization = cc ? cc.balance / cc.limit : null;
    const dti = f.salaryAnnual ? sum(debts.map((d) => d.minPayment || 0)) / (f.salaryAnnual / 12) : null;
    const credit = f.creditScore || [];
    const creditNow = credit.length ? credit[credit.length - 1].score : null;
    const credit12 = credit.length ? credit[0].score : null;

    // budget vs actual: last full month if tracked, otherwise this month so far
    const budgetMonth = hasLast ? last : cur;
    const budgetPartial = !hasLast;
    const budgetCats = Object.keys(budgetMap).filter((c) => budgetMap[c] > 0);
    const budgetLast = budgetCats.map((c) => ({ cat: c, budget: budgetMap[c], actual: (byMonthCat[budgetMonth] || {})[c] || 0 }));
    const overBudget = budgetLast.filter((b) => b.actual > b.budget * 1.05).sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget));
    const catChange = hasLast && hasPrev ? cats.map((c) => ({ cat: c, last: byMonthCat[last][c] || 0, prev: byMonthCat[prev][c] || 0, change: pct(byMonthCat[last][c] || 0, byMonthCat[prev][c] || 0) }))
      .filter((x) => x.prev > 40) : [];
    const subs = txs.filter((t) => t.category === 'Subscriptions' && monthKey(t.date) === last);

    const goals = (f.savingsGoals || []).map((g) => {
      const key = /japan/i.test(g.name) ? /japan/i : null;
      const monthly = key ? avg(fullMonths.slice(-3).map((m) => sum(txs.filter((t) => monthKey(t.date) === m && t.category === 'Savings transfers' && key.test(t.merchant)).map((t) => t.amount)))) : 0;
      const remaining = g.target - g.saved;
      const monthsLeft = Math.max(0, (toDate(g.deadline) - toDate(asOf)) / (DAY * 30.44));
      return { ...g, remaining, monthly, monthsToGoal: monthly ? remaining / monthly : null, monthsLeft, neededMonthly: monthsLeft ? remaining / monthsLeft : remaining };
    });

    const budgetAdherence = budgetLast.length ? clamp(1 - sum(overBudget.map((b) => b.actual - b.budget)) / sum(budgetLast.map((b) => b.budget)) * 4) : null;
    const srForScore = ok(avgSavingsRate3) ? avgSavingsRate3 : projRate;
    const score = weighted([
      [0.30, ok(srForScore) ? clamp(srForScore / 0.20) : null],
      [0.25, ok(efundMonths) ? clamp(efundMonths / (f.emergencyFundTargetMonths || 6)) : null],
      [0.15, ok(utilization) ? clamp(1 - Math.max(0, utilization - 0.1) / 0.3) : null],
      [0.15, ok(creditNow) ? clamp((creditNow - 580) / 220) : null],
      [0.15, budgetAdherence]], 2);

    const has = { tx: userTx > 0, txCount: userTx, last: hasLast, prev: hasPrev, income: !!f.netMonthlyIncome || (f.income || []).length > 0,
      accounts: accounts.length > 0, debts: debts.length > 0, budget: budgetLast.length > 0, credit: ok(creditNow), any: userTx > 0 || accounts.length > 0 || debts.length > 0 || !!f.netMonthlyIncome };

    return {
      cur, last, prev, months, fullMonths, cats, byMonthCat, income, debtPay, savedXfer, spend, mtd, dayOfMonth,
      savingsRate, lastSavingsRate, avgSavingsRate3, projRate, projSpend, rateNow, rateBasis, surplus3, checking, efund, tripFund, efundMonths, essentials,
      assets, liabilities, netWorth: assets - liabilities, utilization, cc, dti, creditNow, credit12, credit,
      budgetLast, overBudget, budgetMonth, budgetPartial, catChange, subs, goals, score, monthLabel, monthName, debts, accounts,
      netWorthHistory: f.netWorthHistory || [], netMonthlyIncome: f.netMonthlyIncome, incomeEstimated: f.incomeEstimated || [], has, transactions: txs,
      monthlyBudget: budgetMap,
    };
  }

  function health(p, asOf) {
    const h = p.health;
    const d = h.daily || [];
    const goals = h.goals || {};
    const lastN = (n) => d.filter((x) => daysBetween(x.date, asOf) < n);
    const prevN = (n, skip) => d.filter((x) => { const k = daysBetween(x.date, asOf); return k >= skip && k < skip + n; });
    const l14 = lastN(14), l7 = lastN(7), l30 = lastN(30);
    const val = (arr, k) => arr.map((x) => x[k]).filter(ok);
    const sleep14 = mean(val(l14, 'sleepHours'));
    const sleepPrev = mean(val(prevN(30, 14), 'sleepHours'));
    const nights14 = val(l14, 'sleepHours').length;
    const shortNights = val(l14, 'sleepHours').filter((x) => x < 7).length;
    const steps7 = mean(val(l7, 'steps'));
    const steps30 = mean(val(l30, 'steps'));
    const stepDays14 = val(l14, 'steps').length;
    const stepDaysHit = goals.steps ? val(l14, 'steps').filter((x) => x >= goals.steps).length : 0;
    const wNow = mean(val(l7, 'weightLb'));
    const w30 = mean(val(d.filter((x) => { const k = daysBetween(x.date, asOf); return k >= 28 && k < 35; }), 'weightLb'));
    const weighed = d.filter((x) => ok(x.weightLb));
    const wFirst = weighed.length >= 2 ? weighed[0] : null;
    const wLatest = weighed.length ? weighed[weighed.length - 1] : null;
    const unit = h.unit || 'lb';
    const wLb = ok(wNow) ? (unit === 'kg' ? wNow * 2.20462 : wNow) : null;
    const bmi = ok(wLb) && h.heightIn ? (wLb / (h.heightIn * h.heightIn)) * 703 : null;
    const bpAll = h.bloodPressure || [];
    const bpRecent = bpAll.filter((x) => daysBetween(x.date, asOf) < 21);
    const bpOlder = bpAll.filter((x) => daysBetween(x.date, asOf) >= 21);
    const sys = mean(bpRecent.map((x) => x.systolic)), dia = mean(bpRecent.map((x) => x.diastolic));
    const sysOld = mean(bpOlder.map((x) => x.systolic)), diaOld = mean(bpOlder.map((x) => x.diastolic));
    const bpCat = (s, di) => (!ok(s) ? null : s >= 140 || di >= 90 ? 'Stage 2 range' : s >= 130 || di >= 80 ? 'Stage 1 range' : s >= 120 ? 'Elevated range' : 'Normal range');
    const workouts = h.workouts || [];
    const wk = (from, to) => workouts.filter((w) => { const k = daysBetween(w.date, asOf); return k >= from && k < to; });
    const workouts14 = wk(0, 14), workoutsPrev = wk(14, 42);
    const hasWorkouts = workouts.length > 0;
    const workoutsPerWeek = hasWorkouts ? workouts14.length / 2 : null, workoutsPerWeekPrev = hasWorkouts ? workoutsPrev.length / 4 : null;
    const mood14 = mean(val(l14, 'mood')), moodPrev = mean(val(prevN(30, 14), 'mood'));
    const energy14 = mean(val(l14, 'energy'));
    const stress14 = mean(val(l14, 'stress'));
    // sleep -> same-day mood link (needs at least 2 days on each side)
    const both = d.filter((x) => ok(x.sleepHours) && ok(x.mood));
    const good = both.filter((x) => x.sleepHours >= 7), bad = both.filter((x) => x.sleepHours < 7);
    const linkOK = good.length >= 2 && bad.length >= 2;
    const moodGoodSleep = linkOK ? mean(good.map((x) => x.mood)) : null, moodBadSleep = linkOK ? mean(bad.map((x) => x.mood)) : null;
    const rhr14 = mean(val(l14, 'restingHR')), rhrPrev = mean(val(prevN(30, 14), 'restingHR'));
    const water14 = mean(val(l14, 'waterCups'));
    const workoutTypes = {};
    workouts.filter((w) => daysBetween(w.date, asOf) < 30).forEach((w) => { workoutTypes[w.type] = (workoutTypes[w.type] || 0) + w.minutes; });

    const bpScore = !ok(sys) ? null : sys < 120 && dia < 80 ? 1 : sys < 130 && dia < 80 ? 0.75 : sys < 140 && dia < 90 ? 0.45 : 0.15;
    const score = l14.length < 3 ? null : weighted([
      [0.30, ok(sleep14) && goals.sleepHours ? clamp((sleep14 - 5.5) / (goals.sleepHours - 5.5)) : null],
      [0.20, ok(steps7) && goals.steps ? clamp(steps7 / goals.steps) : null],
      [0.20, ok(workoutsPerWeek) && goals.workoutsPerWeek ? clamp(workoutsPerWeek / goals.workoutsPerWeek) : null],
      [0.15, bpScore],
      [0.15, ok(mood14) ? clamp((mood14 - 1) / 3.5) : null]], 2);

    return { goals, daily: d, l14, l30, sleep14, sleepPrev, nights14, shortNights, steps7, steps30, stepDays14, stepDaysHit, wNow, w30, wFirst, wLatest, unit, bmi,
      bp: bpAll, sys, dia, sysOld, diaOld, bpCat: bpCat(sys, dia), bpCatOld: bpCat(sysOld, diaOld),
      workouts, workouts14, workoutsPerWeek, workoutsPerWeekPrev, mood14, moodPrev, energy14, stress14,
      moodGoodSleep, moodBadSleep, rhr14, rhrPrev, water14, workoutTypes, score, has: { any: d.length > 0, days: d.length, days14: l14.length, bp: bpAll.length > 0, weight: weighed.length > 0, workouts: hasWorkouts } };
  }

  function relationships(p, asOf) {
    const r = p.relationships;
    const contacts = (r.contacts || []).map((c) => {
      const ints = c.interactions || [];
      const lastI = ints.length ? ints[ints.length - 1] : { date: c.added || asOf, type: 'added' };
      const daysSince = Math.max(0, daysBetween(lastI.date, asOf));
      const overdue = daysSince - c.targetEveryDays;
      const in30 = ints.filter((i) => daysBetween(i.date, asOf) < 30).length;
      return { ...c, interactions: ints, last: lastI, neverLogged: !ints.length, daysSince, overdue, in30, priority: overdue > 0 ? overdue / c.targetEveryDays * c.closeness : 0,
        health: clamp(c.targetEveryDays / Math.max(1, daysSince)) };
    });
    const overdue = contacts.filter((c) => c.overdue > 0).sort((a, b) => b.priority - a.priority);
    const upcoming = (r.importantDates || []).map((e) => ({ ...e, inDays: daysBetween(asOf, e.date) }))
      .filter((e) => e.inDays >= 0).sort((a, b) => a.inDays - b.inDays);
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const from = w * 7, to = from + 7;
      const n = sum(contacts.filter((c) => c.group !== 'partner').map((c) => c.interactions.filter((i) => { const k = daysBetween(i.date, asOf); return k >= from && k < to; }).length));
      const end = new Date(toDate(asOf) - from * DAY);
      weeks.push({ label: MONTHS[end.getMonth()] + ' ' + end.getDate(), n });
    }
    const totalCloseness = sum(contacts.map((c) => c.closeness));
    const score = contacts.length && totalCloseness ? Math.round(100 * sum(contacts.map((c) => c.health * c.closeness)) / totalCloseness) : null;
    const family = contacts.filter((c) => c.group === 'family');
    const logged = sum(contacts.map((c) => c.interactions.length));
    return { contacts, overdue, upcoming, weeks, score, family, onTrack: contacts.filter((c) => c.overdue <= 0).length, has: { any: contacts.length > 0, logged } };
  }

  function career(p, asOf, habitsM) {
    const c = p.career || {};
    const sh = c.salaryHistory || [];
    const salary = sh.length ? sh[sh.length - 1].salary : null;
    const gapPct = ok(salary) && c.marketRange ? pct(c.marketRange.mid, salary) : null;
    const fh = c.focusHoursByWeek || [];
    const recent = fh.slice(-4), earlier = fh.slice(0, 4);
    const deepNow = mean(recent.map((w) => w.deep)), deepBefore = mean(earlier.map((w) => w.deep));
    const meetNow = mean(recent.map((w) => w.meetings)), meetBefore = mean(earlier.map((w) => w.meetings));
    const goals = (c.goals || []).map((g) => {
      const ms = g.milestones || [];
      const daysLeft = g.due ? daysBetween(asOf, g.due) : null;
      const done = ms.filter((m) => m.done).length;
      const next = ms.find((m) => !m.done);
      return { ...g, milestones: ms, daysLeft, done, next };
    });
    const daysToReview = c.nextReview ? daysBetween(asOf, c.nextReview) : null;
    const first = sh[0], lastS = sh[sh.length - 1];
    const cagr = sh.length > 1 ? (Math.pow(lastS.salary / first.salary, 1 / (lastS.year - first.year)) - 1) * 100 : null;
    const score = weighted([
      [0.4, goals.length ? avg(goals.map((g) => g.progress)) / 100 : null],
      [0.3, habitsM.rate14],
      [0.3, ok(deepNow) && ok(meetNow) && deepNow + meetNow > 0 ? clamp(deepNow / (deepNow + meetNow) / 0.55) : null]], 1);
    return { ...c, salaryHistory: sh, skills: c.skills || [], focusHoursByWeek: fh, salary, gapPct, deepNow, deepBefore, meetNow, meetBefore, goals, daysToReview, cagr, score,
      has: { goals: goals.length > 0, salary: ok(salary), focus: fh.length > 0, skills: (c.skills || []).length > 0 } };
  }

  function habits(p, asOf) {
    const list = (p.habits || []).map((h) => {
      const l14 = h.log.filter((x) => daysBetween(x.date, asOf) < 14);
      const p14 = h.log.filter((x) => daysBetween(x.date, asOf) >= 14);
      let streak = 0;
      for (let i = h.log.length - 1; i >= 0 && h.log[i].done; i--) streak++;
      return { id: h.id, name: h.name, log: h.log, rate14: l14.length ? avg(l14.map((x) => (x.done ? 1 : 0))) : null, ratePrev: p14.length ? avg(p14.map((x) => (x.done ? 1 : 0))) : null, streak, days: l14.length };
    });
    return { list, rate14: mean(list.map((h) => h.rate14)), ratePrev: mean(list.map((h) => h.ratePrev)) };
  }

  function buildModel(p) {
    const asOf = p.meta.asOf;
    refYear = asOf.slice(0, 4);
    const fin = finance(p, asOf);
    const hl = health(p, asOf);
    const rel = relationships(p, asOf);
    const hab = habits(p, asOf);
    const car = career(p, asOf, hab);
    const weights = { finance: 0.27, health: 0.27, relationships: 0.23, career: 0.23 };
    const scores = { finance: fin.score, health: hl.score, relationships: rel.score, career: car.score };
    const life = weighted(Object.keys(weights).map((k) => [weights[k], ok(scores[k]) ? scores[k] / 100 : null]), 1);
    const areas = Object.keys(weights).filter((k) => ok(scores[k])).length;
    return { persona: p, asOf, isDemo: !!p.meta.fictional, profile: p.profile, finance: fin, health: hl, relationships: rel, career: car, habits: hab,
      scores: { life, ...scores }, areas, weights };
  }

  // ---------- formatting helpers shared by UI + chat ----------
  const fmt = {
    usd: (n, dp = 0) => (!ok(n) ? '–' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
    pct: (n, dp = 0) => (!ok(n) ? '–' : (n > 0 ? '+' : '') + n.toFixed(dp) + '%'),
    num: (n, dp = 0) => (!ok(n) ? '–' : n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
    date: (s) => { const d = toDate(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); },
    days: (n) => n === 0 ? 'today' : n === 1 ? '1 day' : n + ' days',
  };

  const who = (c) => (['Mom', 'Dad'].includes(c.relation) ? c.relation : /^Grand/.test(c.name) ? c.name : c.name.split(' ')[0]);
  window.Evenself = Object.assign(window.Evenself || {}, { buildModel, fmt, who, util: { toDate, iso, daysBetween, sum, avg, mean, ok, pct, clamp, monthLabel, monthName, addMonths, daysInMonth } });
})();
