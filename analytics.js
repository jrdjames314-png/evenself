/* Evenself demo: analytics engine.
   Turns raw persona data into a "twin model": every number, score and insight on the page
   (and every chat answer) is computed here from data/persona.json. Nothing is hardcoded. */
(function () {
  'use strict';

  const DAY = 86400000;
  const toDate = (s) => new Date(s + 'T12:00:00');
  const iso = (dt) => dt.toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
  const monthKey = (s) => s.slice(0, 7);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (k) => MONTHS[+k.slice(5, 7) - 1] + (k.slice(0, 4) !== '2026' ? ' ' + k.slice(2, 4) : '');
  const monthName = (k) => ['January','February','March','April','May','June','July','August','September','October','November','December'][+k.slice(5, 7) - 1];
  const addMonths = (k, n) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const daysInMonth = (k) => new Date(+k.slice(0, 4), +k.slice(5, 7), 0).getDate();

  const NON_SPEND = new Set(['Savings transfers', 'Debt payments']);

  function finance(p, asOf) {
    const f = p.finance;
    const cur = monthKey(asOf);
    const last = addMonths(cur, -1);
    const prev = addMonths(cur, -2);
    const months = [];
    for (let k = monthKey(f.transactions[0].date); k <= cur; k = addMonths(k, 1)) months.push(k);
    const fullMonths = months.filter((m) => m !== cur);

    const cats = Object.keys(f.monthlyBudget);
    const byMonthCat = {};
    const debtPay = {}, savedXfer = {}, income = {};
    months.forEach((m) => { byMonthCat[m] = Object.fromEntries(cats.map((c) => [c, 0])); debtPay[m] = 0; savedXfer[m] = 0; income[m] = 0; });
    f.transactions.forEach((t) => {
      const m = monthKey(t.date);
      if (t.category === 'Debt payments') debtPay[m] += t.amount;
      else if (t.category === 'Savings transfers') savedXfer[m] += t.amount;
      else byMonthCat[m][t.category] = (byMonthCat[m][t.category] || 0) + t.amount;
    });
    f.income.forEach((i) => { income[monthKey(i.date)] += i.amount; });
    const spend = (m) => sum(Object.values(byMonthCat[m]));

    // same-point-in-month comparison (e.g. Oct 1–9 vs Sep 1–9)
    const dayOfMonth = +asOf.slice(8, 10);
    const mtd = (m, cat) => sum(f.transactions.filter((t) => monthKey(t.date) === m && +t.date.slice(8, 10) <= dayOfMonth && (cat ? t.category === cat : !NON_SPEND.has(t.category))).map((t) => t.amount));

    const savingsRate = (m) => (income[m] ? (income[m] - spend(m) - debtPay[m]) / income[m] : 0);
    const lastSavingsRate = savingsRate(last);
    const avgSavingsRate3 = avg(fullMonths.slice(-3).map(savingsRate));
    const surplus3 = avg(fullMonths.slice(-3).map((m) => income[m] - spend(m) - debtPay[m] - savedXfer[m]));

    const acct = (type) => f.accounts.filter((a) => a.type === type);
    const checking = sum(acct('checking').map((a) => a.balance));
    const efund = f.accounts.find((a) => /emergency/i.test(a.name)).balance;
    const tripFund = f.accounts.find((a) => /trip/i.test(a.name));
    const assets = sum(f.accounts.map((a) => a.balance));
    const liabilities = sum(f.debts.map((d) => d.balance));
    const essentialsCats = ['Housing', 'Utilities', 'Groceries', 'Transport', 'Subscriptions', 'Pets', 'Health & Fitness'];
    const essentials = avg(fullMonths.slice(-3).map((m) => sum(essentialsCats.map((c) => byMonthCat[m][c])) + debtPay[m]));
    const efundMonths = efund / essentials;
    const cc = f.debts.find((d) => d.limit);
    const utilization = cc ? cc.balance / cc.limit : 0;
    const dti = sum(f.debts.map((d) => d.minPayment)) / (f.salaryAnnual / 12);
    const credit = f.creditScore;
    const creditNow = credit[credit.length - 1].score;
    const credit12 = credit[0].score;

    const budgetLast = cats.map((c) => ({ cat: c, budget: f.monthlyBudget[c], actual: byMonthCat[last][c] }));
    const overBudget = budgetLast.filter((b) => b.actual > b.budget * 1.05).sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget));
    const catChange = cats.map((c) => ({ cat: c, last: byMonthCat[last][c], prev: byMonthCat[prev][c], change: pct(byMonthCat[last][c], byMonthCat[prev][c]) }))
      .filter((x) => x.prev > 40);
    const subs = f.transactions.filter((t) => t.category === 'Subscriptions' && monthKey(t.date) === last);

    const goals = f.savingsGoals.map((g) => {
      // average monthly auto-transfer into this goal's account over the last 3 full months (from transactions)
      const key = /japan/i.test(g.name) ? /japan/i : null;
      const monthly = key ? avg(fullMonths.slice(-3).map((m) => sum(f.transactions.filter((t) => monthKey(t.date) === m && t.category === 'Savings transfers' && key.test(t.merchant)).map((t) => t.amount)))) : 0;
      const remaining = g.target - g.saved;
      const monthsLeft = Math.max(0, (toDate(g.deadline) - toDate(asOf)) / (DAY * 30.44));
      return { ...g, remaining, monthly, monthsToGoal: monthly ? remaining / monthly : null, monthsLeft, neededMonthly: monthsLeft ? remaining / monthsLeft : remaining };
    });

    // finance score (0-100)
    const budgetAdherence = clamp(1 - sum(overBudget.map((b) => b.actual - b.budget)) / sum(budgetLast.map((b) => b.budget)) * 4);
    const score = Math.round(100 * (
      0.30 * clamp(avgSavingsRate3 / 0.20) +
      0.25 * clamp(efundMonths / f.emergencyFundTargetMonths) +
      0.15 * clamp(1 - Math.max(0, utilization - 0.1) / 0.3) +
      0.15 * clamp((creditNow - 580) / 220) +
      0.15 * budgetAdherence));

    return {
      cur, last, prev, months, fullMonths, cats, byMonthCat, income, debtPay, savedXfer, spend, mtd, dayOfMonth,
      savingsRate, lastSavingsRate, avgSavingsRate3, surplus3, checking, efund, tripFund, efundMonths, essentials,
      assets, liabilities, netWorth: assets - liabilities, utilization, cc, dti, creditNow, credit12, credit,
      budgetLast, overBudget, catChange, subs, goals, score, monthLabel, monthName, debts: f.debts, accounts: f.accounts,
      netWorthHistory: f.netWorthHistory, netMonthlyIncome: f.netMonthlyIncome,
    };
  }

  function health(p, asOf) {
    const h = p.health;
    const d = h.daily;
    const lastN = (n) => d.filter((x) => daysBetween(x.date, asOf) < n);
    const prevN = (n, skip) => d.filter((x) => { const k = daysBetween(x.date, asOf); return k >= skip && k < skip + n; });
    const l14 = lastN(14), l7 = lastN(7), l30 = lastN(30);
    const sleep14 = avg(l14.map((x) => x.sleepHours));
    const sleepPrev = avg(prevN(30, 14).map((x) => x.sleepHours));
    const shortNights = l14.filter((x) => x.sleepHours < 7).length;
    const steps7 = avg(l7.map((x) => x.steps));
    const steps30 = avg(l30.map((x) => x.steps));
    const stepDaysHit = l14.filter((x) => x.steps >= h.goals.steps).length;
    const wNow = avg(l7.map((x) => x.weightLb));
    const w30 = avg(d.filter((x) => { const k = daysBetween(x.date, asOf); return k >= 28 && k < 35; }).map((x) => x.weightLb));
    const bmi = (wNow / (h.heightIn * h.heightIn)) * 703;
    const bpRecent = h.bloodPressure.filter((x) => daysBetween(x.date, asOf) < 21);
    const bpOlder = h.bloodPressure.filter((x) => daysBetween(x.date, asOf) >= 21);
    const sys = avg(bpRecent.map((x) => x.systolic)), dia = avg(bpRecent.map((x) => x.diastolic));
    const sysOld = avg(bpOlder.map((x) => x.systolic)), diaOld = avg(bpOlder.map((x) => x.diastolic));
    const bpCat = (s, di) => (s >= 140 || di >= 90 ? 'Stage 2 range' : s >= 130 || di >= 80 ? 'Stage 1 range' : s >= 120 ? 'Elevated range' : 'Normal range');
    const wk = (from, to) => h.workouts.filter((w) => { const k = daysBetween(w.date, asOf); return k >= from && k < to; });
    const workouts14 = wk(0, 14), workoutsPrev = wk(14, 42);
    const workoutsPerWeek = workouts14.length / 2, workoutsPerWeekPrev = workoutsPrev.length / 4;
    const mood14 = avg(l14.map((x) => x.mood)), moodPrev = avg(prevN(30, 14).map((x) => x.mood));
    const stress14 = avg(l14.map((x) => x.stress));
    // sleep -> same-day mood link
    const good = d.filter((x) => x.sleepHours >= 7), bad = d.filter((x) => x.sleepHours < 7);
    const moodGoodSleep = avg(good.map((x) => x.mood)), moodBadSleep = avg(bad.map((x) => x.mood));
    const rhr14 = avg(l14.map((x) => x.restingHR)), rhrPrev = avg(prevN(30, 14).map((x) => x.restingHR));
    const water14 = avg(l14.map((x) => x.waterCups));
    const workoutTypes = {};
    h.workouts.filter((w) => daysBetween(w.date, asOf) < 30).forEach((w) => { workoutTypes[w.type] = (workoutTypes[w.type] || 0) + w.minutes; });

    const bpScore = sys < 120 && dia < 80 ? 1 : sys < 130 && dia < 80 ? 0.75 : sys < 140 && dia < 90 ? 0.45 : 0.15;
    const score = Math.round(100 * (
      0.30 * clamp((sleep14 - 5.5) / (h.goals.sleepHours - 5.5)) +
      0.20 * clamp(steps7 / h.goals.steps) +
      0.20 * clamp(workoutsPerWeek / h.goals.workoutsPerWeek) +
      0.15 * bpScore +
      0.15 * clamp((mood14 - 1) / 3.5)));

    return { goals: h.goals, daily: d, l14, l30, sleep14, sleepPrev, shortNights, steps7, steps30, stepDaysHit, wNow, w30, bmi,
      bp: h.bloodPressure, sys, dia, sysOld, diaOld, bpCat: bpCat(sys, dia), bpCatOld: bpCat(sysOld, diaOld),
      workouts: h.workouts, workouts14, workoutsPerWeek, workoutsPerWeekPrev, mood14, moodPrev, stress14,
      moodGoodSleep, moodBadSleep, rhr14, rhrPrev, water14, workoutTypes, score };
  }

  function relationships(p, asOf) {
    const r = p.relationships;
    const contacts = r.contacts.map((c) => {
      const lastI = c.interactions[c.interactions.length - 1];
      const daysSince = daysBetween(lastI.date, asOf);
      const overdue = daysSince - c.targetEveryDays;
      const in30 = c.interactions.filter((i) => daysBetween(i.date, asOf) < 30).length;
      return { ...c, last: lastI, daysSince, overdue, in30, priority: overdue > 0 ? overdue / c.targetEveryDays * c.closeness : 0,
        health: clamp(c.targetEveryDays / Math.max(1, daysSince)) };
    });
    const overdue = contacts.filter((c) => c.overdue > 0).sort((a, b) => b.priority - a.priority);
    const upcoming = r.importantDates.map((e) => ({ ...e, inDays: daysBetween(asOf, e.date) }))
      .filter((e) => e.inDays >= 0).sort((a, b) => a.inDays - b.inDays);
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const from = w * 7, to = from + 7;
      const n = sum(contacts.filter((c) => c.group !== 'partner').map((c) => c.interactions.filter((i) => { const k = daysBetween(i.date, asOf); return k >= from && k < to; }).length));
      const end = new Date(toDate(asOf) - from * DAY);
      weeks.push({ label: MONTHS[end.getMonth()] + ' ' + end.getDate(), n });
    }
    const totalCloseness = sum(contacts.map((c) => c.closeness));
    const score = Math.round(100 * sum(contacts.map((c) => c.health * c.closeness)) / totalCloseness);
    const family = contacts.filter((c) => c.group === 'family');
    return { contacts, overdue, upcoming, weeks, score, family, onTrack: contacts.filter((c) => c.overdue <= 0).length };
  }

  function career(p, asOf, habitsM) {
    const c = p.career;
    const salary = c.salaryHistory[c.salaryHistory.length - 1].salary;
    const gapPct = pct(c.marketRange.mid, salary);
    const fh = c.focusHoursByWeek;
    const recent = fh.slice(-4), earlier = fh.slice(0, 4);
    const deepNow = avg(recent.map((w) => w.deep)), deepBefore = avg(earlier.map((w) => w.deep));
    const meetNow = avg(recent.map((w) => w.meetings)), meetBefore = avg(earlier.map((w) => w.meetings));
    const goals = c.goals.map((g) => {
      const daysLeft = daysBetween(asOf, g.due);
      const done = g.milestones.filter((m) => m.done).length;
      const next = g.milestones.find((m) => !m.done);
      return { ...g, daysLeft, done, next };
    });
    const daysToReview = daysBetween(asOf, c.nextReview);
    const first = c.salaryHistory[0], lastS = c.salaryHistory[c.salaryHistory.length - 1];
    const cagr = (Math.pow(lastS.salary / first.salary, 1 / (lastS.year - first.year)) - 1) * 100;
    const score = Math.round(100 * (0.4 * avg(goals.map((g) => g.progress)) / 100 + 0.3 * habitsM.rate14 + 0.3 * clamp(deepNow / (deepNow + meetNow) / 0.55)));
    return { ...c, salary, gapPct, deepNow, deepBefore, meetNow, meetBefore, goals, daysToReview, cagr, score };
  }

  function habits(p, asOf) {
    const list = p.habits.map((h) => {
      const l14 = h.log.filter((x) => daysBetween(x.date, asOf) < 14);
      const p14 = h.log.filter((x) => daysBetween(x.date, asOf) >= 14);
      let streak = 0;
      for (let i = h.log.length - 1; i >= 0 && h.log[i].done; i--) streak++;
      return { name: h.name, log: h.log, rate14: avg(l14.map((x) => (x.done ? 1 : 0))), ratePrev: avg(p14.map((x) => (x.done ? 1 : 0))), streak };
    });
    return { list, rate14: avg(list.map((h) => h.rate14)), ratePrev: avg(list.map((h) => h.ratePrev)) };
  }

  function buildModel(p) {
    const asOf = p.meta.asOf;
    const fin = finance(p, asOf);
    const hl = health(p, asOf);
    const rel = relationships(p, asOf);
    const hab = habits(p, asOf);
    const car = career(p, asOf, hab);
    const weights = { finance: 0.27, health: 0.27, relationships: 0.23, career: 0.23 };
    const life = Math.round(fin.score * weights.finance + hl.score * weights.health + rel.score * weights.relationships + car.score * weights.career);
    return { persona: p, asOf, profile: p.profile, finance: fin, health: hl, relationships: rel, career: car, habits: hab,
      scores: { life, finance: fin.score, health: hl.score, relationships: rel.score, career: car.score }, weights };
  }

  // ---------- formatting helpers shared by UI + chat ----------
  const fmt = {
    usd: (n, dp = 0) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }),
    pct: (n, dp = 0) => (n > 0 ? '+' : '') + n.toFixed(dp) + '%',
    num: (n, dp = 0) => n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }),
    date: (s) => { const d = toDate(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); },
    days: (n) => n === 0 ? 'today' : n === 1 ? '1 day' : n + ' days',
  };

  const who = (c) => (['Mom', 'Dad'].includes(c.relation) ? c.relation : /^Grand/.test(c.name) ? c.name : c.name.split(' ')[0]);
  window.Evenself = Object.assign(window.Evenself || {}, { buildModel, fmt, who, util: { toDate, iso, daysBetween, sum, avg, pct, clamp, monthLabel, monthName, addMonths, daysInMonth } });
})();
