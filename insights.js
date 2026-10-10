/* Evenself demo: insight generator.
   Every insight is a template filled with numbers computed in analytics.js; whether it appears
   (and its tone) depends on thresholds checked against the data, so changing persona.json changes the insights. */
(function () {
  'use strict';
  const { fmt } = window.Evenself;
  const I = (tone, text, detail) => ({ tone, text, detail });

  function financeInsights(M) {
    const F = M.finance, out = [];
    const L = F.monthName(F.last), P = F.monthName(F.prev);
    const moves = F.catChange.slice().sort((a, b) => Math.abs(b.last - b.prev) - Math.abs(a.last - a.prev));
    const big = moves[0];
    if (big && Math.abs(big.change) >= 10) {
      out.push(I(big.change > 0 ? 'warn' : 'good',
        `${big.cat} spend ${big.change > 0 ? 'up' : 'down'} ${Math.abs(big.change).toFixed(0)}% in ${L} vs ${P}`,
        `${fmt.usd(big.last)} vs ${fmt.usd(big.prev)}. It's your biggest month-over-month change.`));
    }
    if (F.overBudget.length) {
      const top = F.overBudget.slice(0, 2).map((b) => `${b.cat} (+${fmt.usd(b.actual - b.budget)})`).join(' and ');
      out.push(I('warn', `${L}: over budget in ${F.overBudget.length} ${F.overBudget.length === 1 ? 'category' : 'categories'}`, `Biggest overruns: ${top}.`));
    } else out.push(I('good', `${L}: every category stayed within budget`, `Total spend ${fmt.usd(F.spend(F.last))}.`));
    const sr = F.lastSavingsRate * 100, sr3 = F.avgSavingsRate3 * 100;
    out.push(I(sr >= 20 ? 'good' : sr >= 10 ? 'info' : 'warn', `Saved ${sr.toFixed(0)}% of take-home pay in ${L}`,
      `3-month average ${sr3.toFixed(0)}%. A common target is 20%.`));
    const gap = Math.max(0, F.essentials * 6 - F.efund);
    out.push(I(F.efundMonths >= 6 ? 'good' : F.efundMonths >= 3 ? 'info' : 'warn',
      `Emergency fund covers ${F.efundMonths.toFixed(1)} months of essentials`,
      gap > 0 ? `${fmt.usd(gap)} more reaches the 6-month goal (essentials ≈ ${fmt.usd(F.essentials)}/mo).` : 'The 6-month goal is met.'));
    const dc = F.creditNow - F.credit12;
    out.push(I(dc >= 0 ? 'good' : 'warn', `Credit score ${F.creditNow}, ${dc >= 0 ? 'up' : 'down'} ${Math.abs(dc)} points in 12 months`,
      `Card utilization is ${(F.utilization * 100).toFixed(0)}%${F.utilization > 0.1 ? '. Under 10% usually helps a bit more.' : '.'}`));
    return out.slice(0, 5);
  }

  function healthInsights(M) {
    const H = M.health, out = [];
    out.push(I(H.shortNights >= 7 ? 'bad' : H.shortNights >= 4 ? 'warn' : 'good', `Sleep under 7h on ${H.shortNights} of the last 14 nights`,
      `Average ${H.sleep14.toFixed(1)}h, vs ${H.sleepPrev.toFixed(1)}h the month before. Your goal is ${H.goals.sleepHours}h.`));
    const dm = H.moodGoodSleep - H.moodBadSleep;
    if (Math.abs(dm) >= 0.2) out.push(I('info', `Mood is ${dm.toFixed(1)} points ${dm > 0 ? 'higher' : 'lower'} on days with 7h+ sleep`,
      `${H.moodGoodSleep.toFixed(1)}/5 vs ${H.moodBadSleep.toFixed(1)}/5 across 90 days of logs.`));
    out.push(I(H.workoutsPerWeek >= H.goals.workoutsPerWeek ? 'good' : H.workoutsPerWeek < H.workoutsPerWeekPrev ? 'warn' : 'info',
      `${H.workoutsPerWeek.toFixed(1)} workouts/week over the last 2 weeks`,
      `Down from ${H.workoutsPerWeekPrev.toFixed(1)}/week before that. Goal: ${H.goals.workoutsPerWeek}.`));
    const bpUp = H.sys - H.sysOld;
    out.push(I(/Stage/.test(H.bpCat) ? 'warn' : /Elevated/.test(H.bpCat) ? 'info' : 'good',
      `Blood pressure averaging ${Math.round(H.sys)}/${Math.round(H.dia)} (last 3 weeks)`,
      `${H.bpCat} by AHA categories${Math.abs(bpUp) >= 2 ? `, ${bpUp > 0 ? 'up' : 'down'} from ${Math.round(H.sysOld)}/${Math.round(H.diaOld)} earlier` : ''}. Worth mentioning to a clinician if it stays there.`));
    const dw = H.wNow - H.w30;
    out.push(I(H.steps7 >= H.goals.steps ? 'good' : 'info', `${fmt.num(Math.round(H.steps7))} steps/day this week`,
      `Hit ${H.goals.steps.toLocaleString()}+ on ${H.stepDaysHit} of 14 days. Weight ${dw <= 0 ? 'down' : 'up'} ${Math.abs(dw).toFixed(1)} lb in ~30 days.`));
    return out.slice(0, 5);
  }

  function relationshipInsights(M) {
    const R = M.relationships, out = [];
    R.overdue.slice(0, 3).forEach((c) => out.push(I(c.overdue > c.targetEveryDays ? 'bad' : 'warn',
      `Haven't contacted ${window.Evenself.who(c)} in ${c.daysSince} days`,
      `You aim for every ${c.targetEveryDays} days. Last: ${c.last.type} on ${fmt.date(c.last.date)}. ${c.notes}.`)));
    const next = R.upcoming[0];
    if (next) out.push(I(next.inDays <= 10 ? 'warn' : 'info', `${next.label} in ${fmt.days(next.inDays)}`,
      `${fmt.date(next.date)}. ${R.upcoming[1] ? `After that: ${R.upcoming[1].label} (${fmt.date(R.upcoming[1].date)}).` : ''}`));
    const w = R.weeks, a = w.slice(4).reduce((s, x) => s + x.n, 0), b = w.slice(0, 4).reduce((s, x) => s + x.n, 0);
    if (b) out.push(I(a >= b ? 'good' : 'warn', `${a} check-ins in the last 4 weeks, ${a >= b ? 'up' : 'down'} from ${b}`, 'Counts calls, texts and meetups (excluding your partner).'));
    out.push(I(R.onTrack / R.contacts.length >= 0.7 ? 'good' : 'info', `On track with ${R.onTrack} of ${R.contacts.length} people you care about`, `Based on the contact rhythm you set for each person.`));
    return out.slice(0, 5);
  }

  function careerInsights(M) {
    const C = M.career, out = [];
    out.push(I(C.gapPct > 5 ? 'warn' : 'good', `Salary is ${Math.abs(C.gapPct).toFixed(0)}% ${C.gapPct > 0 ? 'below' : 'above'} the market midpoint`,
      `${fmt.usd(C.salary)} vs ${fmt.usd(C.marketRange.mid)} (demo benchmark). Review in ${fmt.days(C.daysToReview)}, so start the case now.`));
    const dd = ((C.deepNow - C.deepBefore) / C.deepBefore) * 100;
    if (Math.abs(dd) >= 10) out.push(I(dd < 0 ? 'warn' : 'good', `Deep-work time ${dd < 0 ? 'down' : 'up'} ${Math.abs(dd).toFixed(0)}% over 4 weeks`,
      `${C.deepNow.toFixed(1)}h/week now vs ${C.deepBefore.toFixed(1)}h. Meetings went from ${C.meetBefore.toFixed(1)}h to ${C.meetNow.toFixed(1)}h.`));
    const urgent = C.goals.filter((g) => g.daysLeft > 0).map((g) => ({ ...g, pace: g.progress / 100 - 1 + Math.min(1, g.daysLeft / 365) }))
      .sort((a, b) => a.daysLeft - b.daysLeft)[0];
    if (urgent) out.push(I(urgent.progress < 60 && urgent.daysLeft < 90 ? 'warn' : 'info', `"${urgent.name}" is ${urgent.progress}% done, due in ${urgent.daysLeft} days`,
      urgent.next ? `Next milestone: ${urgent.next.name}.` : 'Keep the current pace.'));
    const H = M.habits, dh = (H.rate14 - H.ratePrev) * 100;
    const worst = H.list.slice().sort((a, b) => (a.rate14 - a.ratePrev) - (b.rate14 - b.ratePrev))[0];
    out.push(I(dh < -5 ? 'warn' : 'good', `Habit completion ${(H.rate14 * 100).toFixed(0)}% over the last 2 weeks (${dh >= 0 ? '+' : ''}${dh.toFixed(0)} pts)`,
      `Biggest slip: "${worst.name}" at ${(worst.rate14 * 100).toFixed(0)}% vs ${(worst.ratePrev * 100).toFixed(0)}%.`));
    return out.slice(0, 5);
  }

  function overviewInsights(M) {
    // "daily brief": the most important non-good insight from each area, plus one win
    const all = { finance: financeInsights(M), health: healthInsights(M), relationships: relationshipInsights(M), career: careerInsights(M) };
    const rank = { bad: 0, warn: 1, info: 2, good: 3 };
    const brief = [];
    Object.entries(all).forEach(([k, list]) => { const top = list.slice().sort((a, b) => rank[a.tone] - rank[b.tone])[0]; brief.push({ ...top, domain: k }); });
    const win = Object.entries(all).flatMap(([k, l]) => l.filter((x) => x.tone === 'good').map((x) => ({ ...x, domain: k })))[0];
    if (win) brief.push(win);
    return { all, brief };
  }

  window.Evenself.insights = { financeInsights, healthInsights, relationshipInsights, careerInsights, overviewInsights };
})();
