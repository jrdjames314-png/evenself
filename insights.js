/* Evenself: insight generator.
   Every insight is a template filled with numbers computed in analytics.js; whether it appears (and its tone)
   depends on thresholds checked against the data. When there isn't enough data for an insight, a 'lock' item
   says exactly what to add to unlock it, instead of showing NaN or an empty card. */
(function () {
  'use strict';
  const E = window.Evenself, { fmt } = E, ok = E.util.ok;
  const I = (tone, text, detail, action) => ({ tone, text, detail, action });
  const lock = (text, detail, action) => I('lock', text, detail, action);
  const wu = (H) => H.unit || 'lb';

  function financeInsights(M) {
    const F = M.finance, out = [];
    if (!F.has.any) return [lock('Add your income and a few transactions to unlock money insights', 'Spending trends, savings rate, emergency-fund months and an "can I afford it?" check all come from what you enter.', 'add-tx')];
    const L = F.monthName(F.last), P = F.monthName(F.prev);
    const moves = F.catChange.slice().sort((a, b) => Math.abs(b.last - b.prev) - Math.abs(a.last - a.prev));
    const big = moves[0];
    if (big && Math.abs(big.change) >= 10) {
      out.push(I(big.change > 0 ? 'warn' : 'good',
        `${big.cat} spend ${big.change > 0 ? 'up' : 'down'} ${Math.abs(big.change).toFixed(0)}% in ${L} vs ${P}`,
        `${fmt.usd(big.last)} vs ${fmt.usd(big.prev)}. It's your biggest month-over-month change.`));
    }
    if (F.budgetLast.length) {
      const BM = F.budgetPartial ? `${F.monthName(F.budgetMonth)} so far` : F.monthName(F.budgetMonth);
      if (F.overBudget.length) {
        const top = F.overBudget.slice(0, 2).map((b) => `${b.cat} (+${fmt.usd(b.actual - b.budget)})`).join(' and ');
        out.push(I('warn', `${BM}: over budget in ${F.overBudget.length} ${F.overBudget.length === 1 ? 'category' : 'categories'}`, `Biggest overruns: ${top}.`));
      } else out.push(I('good', `${BM}: every category ${F.budgetPartial ? 'is' : 'stayed'} within budget`, `Total spend ${fmt.usd(F.spend(F.budgetMonth))}.`));
    } else if (F.has.tx) out.push(lock('Set monthly budgets to see where you overspend', 'Add a budget for a few categories in Edit profile → Money.', 'edit-finance'));
    if (F.rateBasis === 'last') {
      const sr = F.lastSavingsRate * 100, sr3 = ok(F.avgSavingsRate3) ? F.avgSavingsRate3 * 100 : sr;
      out.push(I(sr >= 20 ? 'good' : sr >= 10 ? 'info' : 'warn', `Saved ${sr.toFixed(0)}% of take-home pay in ${L}`,
        `3-month average ${sr3.toFixed(0)}%. A common target is 20%.`));
    } else if (F.rateBasis === 'projected') {
      const sr = F.projRate * 100;
      out.push(I(sr >= 20 ? 'good' : sr >= 10 ? 'info' : 'warn', `On pace to save ${sr.toFixed(0)}% of take-home in ${F.monthName(F.cur)}`,
        `Projected from ${F.dayOfMonth} day${F.dayOfMonth === 1 ? '' : 's'} of entries plus your recurring bills (≈${fmt.usd(F.projSpend)} spend). It firms up after a full month. A common target is 20%.`));
    } else if (!F.has.income) out.push(lock('Add your monthly take-home pay to see your savings rate', 'Edit profile → Money → Monthly income.', 'edit-finance'));
    else out.push(lock('Log some spending to see your savings rate', 'Add transactions or import a bank CSV.', 'add-tx'));
    if (ok(F.efundMonths)) {
      const target = M.persona.finance.emergencyFundTargetMonths || 6;
      const gap = Math.max(0, F.essentials * target - F.efund);
      out.push(I(F.efundMonths >= target ? 'good' : F.efundMonths >= 3 ? 'info' : 'warn',
        `Emergency fund covers ${F.efundMonths.toFixed(1)} months of essentials`,
        gap > 0 ? `${fmt.usd(gap)} more reaches the ${target}-month goal (essentials ≈ ${fmt.usd(F.essentials)}/mo).` : `The ${target}-month goal is met.`));
    } else if (!F.has.accounts) out.push(lock('Add your savings to see how many months your emergency fund covers', 'Edit profile → Money → Cash & savings.', 'edit-finance'));
    if (ok(F.creditNow)) {
      const dc = F.creditNow - F.credit12, util = ok(F.utilization) ? `Card utilization is ${(F.utilization * 100).toFixed(0)}%${F.utilization > 0.1 ? '. Under 10% usually helps a bit more.' : '.'}` : 'Add a card limit to see utilization.';
      out.push(F.credit.length > 1 ? I(dc >= 0 ? 'good' : 'warn', `Credit score ${F.creditNow}, ${dc >= 0 ? 'up' : 'down'} ${Math.abs(dc)} points in ${F.credit.length >= 12 ? '12 months' : F.credit.length > 2 ? F.credit.length - 1 + ' months' : 'a month'}`, util)
        : I(F.creditNow >= 740 ? 'good' : F.creditNow >= 670 ? 'info' : 'warn', `Credit score ${F.creditNow}`, util + ' Update it monthly to see the trend.'));
    }
    if (F.has.tx && F.has.txCount < 5) out.push(lock(`${F.has.txCount} transaction${F.has.txCount === 1 ? '' : 's'} logged. Add a few more to unlock spending trends`, 'Quick-add them, or import a CSV from your bank.', 'add-tx'));
    return out.slice(0, 5);
  }

  function healthInsights(M) {
    const H = M.health, out = [];
    if (!H.has.any) return [lock('Do your first daily check-in to unlock health insights', 'Sleep, steps, mood, energy and weight take about 20 seconds a day. Blood pressure is optional.', 'checkin')];
    if (ok(H.sleep14)) {
      const n = H.nights14;
      out.push(I(H.shortNights >= n / 2 ? 'bad' : H.shortNights >= n * 0.28 ? 'warn' : 'good', `Sleep under 7h on ${H.shortNights} of the last ${n} nights`,
        `Average ${H.sleep14.toFixed(1)}h${ok(H.sleepPrev) ? `, vs ${H.sleepPrev.toFixed(1)}h the month before` : ''}. Your goal is ${H.goals.sleepHours}h.`));
    }
    if (ok(H.moodGoodSleep)) {
      const dm = H.moodGoodSleep - H.moodBadSleep;
      if (Math.abs(dm) >= 0.2) out.push(I('info', `Mood is ${Math.abs(dm).toFixed(1)} points ${dm > 0 ? 'higher' : 'lower'} on days with 7h+ sleep`,
        `${H.moodGoodSleep.toFixed(1)}/5 vs ${H.moodBadSleep.toFixed(1)}/5 across ${H.daily.length} days of logs.`));
    } else if (ok(H.mood14)) out.push(I(H.mood14 >= 3.5 ? 'good' : H.mood14 >= 2.5 ? 'info' : 'warn', `Mood averaging ${H.mood14.toFixed(1)}/5${ok(H.energy14) ? `, energy ${H.energy14.toFixed(1)}/5` : ''}`,
      'A few more check-ins with both good and short nights will show whether sleep moves your mood.'));
    if (ok(H.workoutsPerWeek)) out.push(I(H.workoutsPerWeek >= H.goals.workoutsPerWeek ? 'good' : H.workoutsPerWeek < H.workoutsPerWeekPrev ? 'warn' : 'info',
      `${H.workoutsPerWeek.toFixed(1)} workouts/week over the last 2 weeks`,
      `Down from ${H.workoutsPerWeekPrev.toFixed(1)}/week before that. Goal: ${H.goals.workoutsPerWeek}.`));
    if (ok(H.sys)) {
      const bpUp = ok(H.sysOld) ? H.sys - H.sysOld : 0;
      out.push(I(/Stage/.test(H.bpCat) ? 'warn' : /Elevated/.test(H.bpCat) ? 'info' : 'good',
        `Blood pressure averaging ${Math.round(H.sys)}/${Math.round(H.dia)} (last 3 weeks)`,
        `${H.bpCat} by AHA categories${Math.abs(bpUp) >= 2 ? `, ${bpUp > 0 ? 'up' : 'down'} from ${Math.round(H.sysOld)}/${Math.round(H.diaOld)} earlier` : ''}. Worth mentioning to a clinician if it stays there.`));
    }
    if (ok(H.steps7)) {
      let wPart = '';
      if (ok(H.wNow) && ok(H.w30)) { const dw = H.wNow - H.w30; wPart = ` Weight ${dw <= 0 ? 'down' : 'up'} ${Math.abs(dw).toFixed(1)} ${wu(H)} in ~30 days.`; }
      else if (H.wFirst && H.wLatest && H.wFirst.date !== H.wLatest.date) { const dw = H.wLatest.weightLb - H.wFirst.weightLb; wPart = ` Weight ${dw <= 0 ? 'down' : 'up'} ${Math.abs(dw).toFixed(1)} ${wu(H)} since ${fmt.date(H.wFirst.date)}.`; }
      out.push(I(H.steps7 >= H.goals.steps ? 'good' : 'info', `${fmt.num(Math.round(H.steps7))} steps/day this week`,
        `Hit ${H.goals.steps.toLocaleString()}+ on ${H.stepDaysHit} of ${M.isDemo ? 14 : H.stepDays14} days.${wPart}`));
    }
    if (!M.isDemo && H.has.days14 < 7) out.push(lock(`${H.has.days14} of the last 14 days checked in. Trends sharpen after a week`, 'Check in daily (it takes ~20 seconds) to compare weeks and link sleep to mood.', 'checkin'));
    return out.slice(0, 5);
  }

  function relationshipInsights(M) {
    const R = M.relationships, out = [];
    if (!R.has.any) return [lock('Add the people who matter to unlock relationship insights', 'Set how often you want to talk to each person; your twin will tell you who you\'re drifting from and remind you of birthdays.', 'add-person')];
    R.overdue.slice(0, 3).forEach((c) => out.push(I(c.overdue > c.targetEveryDays ? 'bad' : 'warn',
      c.neverLogged ? `No contact logged with ${E.who(c)} in ${c.daysSince} days` : `Haven't contacted ${E.who(c)} in ${c.daysSince} days`,
      `You aim for every ${c.targetEveryDays} days. ${c.neverLogged ? `Added ${fmt.date(c.last.date)}; log your last chat to start the clock.` : `Last: ${c.last.type} on ${fmt.date(c.last.date)}.`}${c.notes ? ' ' + c.notes.replace(/\.?$/, '.') : ''}`)));
    const next = R.upcoming[0];
    if (next) out.push(I(next.inDays <= 10 ? 'warn' : 'info', `${next.label} in ${fmt.days(next.inDays)}`,
      `${fmt.date(next.date)}. ${R.upcoming[1] ? `After that: ${R.upcoming[1].label} (${fmt.date(R.upcoming[1].date)}).` : ''}`));
    const w = R.weeks, a = w.slice(4).reduce((s, x) => s + x.n, 0), b = w.slice(0, 4).reduce((s, x) => s + x.n, 0);
    if (b) out.push(I(a >= b ? 'good' : 'warn', `${a} check-ins in the last 4 weeks, ${a >= b ? 'up' : 'down'} from ${b}`, 'Counts calls, texts and meetups (excluding your partner).'));
    out.push(I(R.onTrack / R.contacts.length >= 0.7 ? 'good' : 'info', `On track with ${R.onTrack} of ${R.contacts.length} people you care about`, `Based on the contact rhythm you set for each person.`));
    if (!M.isDemo && !R.has.logged) out.push(lock('Log a call, text or meetup to start tracking', 'Use "Log contact" whenever you talk to someone.', 'log-contact'));
    return out.slice(0, 5);
  }

  function careerInsights(M) {
    const C = M.career, out = [];
    if (ok(C.gapPct)) out.push(I(C.gapPct > 5 ? 'warn' : 'good', `Salary is ${Math.abs(C.gapPct).toFixed(0)}% ${C.gapPct > 0 ? 'below' : 'above'} the market midpoint`,
      `${fmt.usd(C.salary)} vs ${fmt.usd(C.marketRange.mid)} (demo benchmark). Review in ${fmt.days(C.daysToReview)}, so start the case now.`));
    if (ok(C.deepNow) && C.deepBefore) {
      const dd = ((C.deepNow - C.deepBefore) / C.deepBefore) * 100;
      if (Math.abs(dd) >= 10) out.push(I(dd < 0 ? 'warn' : 'good', `Deep-work time ${dd < 0 ? 'down' : 'up'} ${Math.abs(dd).toFixed(0)}% over 4 weeks`,
        `${C.deepNow.toFixed(1)}h/week now vs ${C.deepBefore.toFixed(1)}h. Meetings went from ${C.meetBefore.toFixed(1)}h to ${C.meetNow.toFixed(1)}h.`));
    }
    if (C.has.goals) {
      const late = C.goals.filter((g) => ok(g.daysLeft) && g.daysLeft < 0 && g.progress < 100)[0];
      if (late) out.push(I('bad', `"${late.name}" passed its target date at ${late.progress}%`, `It was due ${fmt.date(late.due)}. Pick a new date or break it into a smaller next step.`));
      const urgent = C.goals.filter((g) => ok(g.daysLeft) && g.daysLeft > 0 && g.progress < 100).sort((a, b) => a.daysLeft - b.daysLeft)[0];
      if (urgent) out.push(I(urgent.progress < 60 && urgent.daysLeft < 90 ? 'warn' : 'info', `"${urgent.name}" is ${urgent.progress}% done, due in ${urgent.daysLeft} days`,
        urgent.next ? `Next milestone: ${urgent.next.name}.` : M.isDemo ? 'Keep the current pace.' : `About ${Math.max(1, Math.ceil((100 - urgent.progress) / Math.max(1, urgent.daysLeft / 7)))}% a week gets you there on time.`));
      const done = C.goals.filter((g) => g.progress >= 100);
      if (done.length && !M.isDemo) out.push(I('good', `${done.length} goal${done.length > 1 ? 's' : ''} complete`, done.map((g) => g.name).join(', ') + '.'));
    } else out.push(lock('Add a goal with a target date to unlock goal tracking', 'Career, money, health or personal: your twin tracks pace and warns you when one slips.', 'add-goal'));
    const H = M.habits;
    if (ok(H.rate14) && ok(H.ratePrev)) {
      const dh = (H.rate14 - H.ratePrev) * 100;
      const worst = H.list.filter((h) => ok(h.rate14) && ok(h.ratePrev)).sort((a, b) => (a.rate14 - a.ratePrev) - (b.rate14 - b.ratePrev))[0];
      out.push(I(dh < -5 ? 'warn' : 'good', `Habit completion ${(H.rate14 * 100).toFixed(0)}% over the last 2 weeks (${dh >= 0 ? '+' : ''}${dh.toFixed(0)} pts)`,
        worst ? `Biggest slip: "${worst.name}" at ${(worst.rate14 * 100).toFixed(0)}% vs ${(worst.ratePrev * 100).toFixed(0)}%.` : ''));
    } else if (ok(H.rate14)) {
      const best = H.list.filter((h) => h.streak).sort((a, b) => b.streak - a.streak)[0];
      out.push(I(H.rate14 >= 0.7 ? 'good' : H.rate14 >= 0.4 ? 'info' : 'warn', `Habit completion ${(H.rate14 * 100).toFixed(0)}% so far`,
        best ? `Longest current streak: "${best.name}" (${best.streak} day${best.streak > 1 ? 's' : ''}).` : 'Tick habits off in your daily check-in.'));
    } else if (!H.list.length) out.push(lock('Add a habit or two to track streaks', 'For example "Walk 20 minutes" or "No phone after 10pm". Tick them off in the daily check-in.', 'edit-habits'));
    else out.push(lock('Tick off a habit in your daily check-in to start your streak', '', 'checkin'));
    return out.slice(0, 5);
  }

  function overviewInsights(M) {
    // "daily brief": the most important non-good insight from each area, plus one win
    const all = { finance: financeInsights(M), health: healthInsights(M), relationships: relationshipInsights(M), career: careerInsights(M) };
    const rank = { bad: 0, warn: 1, info: 2, lock: 2.5, good: 3 };
    const brief = [];
    Object.entries(all).forEach(([k, list]) => { const top = list.slice().sort((a, b) => rank[a.tone] - rank[b.tone])[0]; if (top) brief.push({ ...top, domain: k }); });
    const win = Object.entries(all).flatMap(([k, l]) => l.filter((x) => x.tone === 'good').map((x) => ({ ...x, domain: k })))[0];
    if (win) brief.push(win);
    return { all, brief };
  }

  window.Evenself.insights = { financeInsights, healthInsights, relationshipInsights, careerInsights, overviewInsights };
})();
