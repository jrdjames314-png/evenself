/* Evenself demo: UI. Renders the twin model into panels + charts and wires up the chat. */
(function () {
  'use strict';
  const E = window.Evenself, { fmt } = E, U = E.util;
  const M = E.buildModel(window.PERSONA);
  const INS = E.insights.overviewInsights(M);
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => n.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const scoreColor = (s) => (s >= 75 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');
  const DISC = {
    finance: 'Not financial advice. Numbers come from fictional demo data; talk to a qualified professional before making money decisions.',
    health: 'Not medical advice. This is a demo with fictional data, so check any health concern with a licensed clinician.',
  };

  // ---------- theme + chart palette ----------
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const PALETTE = ['#7c5cff', '#22c3a6', '#4c8dff', '#f0a020', '#ef5168', '#a78bfa', '#14b8a6', '#f472b6', '#84cc16', '#fb923c', '#38bdf8', '#94a3b8'];
  const charts = {};
  function chartDefaults() {
    const C = window.Chart; if (!C) return;
    C.defaults.font.family = css('--font') || 'system-ui';
    C.defaults.color = css('--muted');
    C.defaults.borderColor = css('--grid');
    C.defaults.plugins.legend.labels.boxWidth = 10; C.defaults.plugins.legend.labels.boxHeight = 10;
    C.defaults.plugins.legend.labels.usePointStyle = true;
    C.defaults.plugins.tooltip.backgroundColor = css('--card-2'); C.defaults.plugins.tooltip.titleColor = css('--text');
    C.defaults.plugins.tooltip.bodyColor = css('--text'); C.defaults.plugins.tooltip.borderColor = css('--border'); C.defaults.plugins.tooltip.borderWidth = 1;
    C.defaults.maintainAspectRatio = false; C.defaults.responsive = true;
    C.defaults.elements.bar.borderRadius = 5; C.defaults.elements.line.tension = 0.35; C.defaults.elements.point.radius = 0; C.defaults.elements.point.hoverRadius = 4;
  }
  function chart(id, cfg) {
    const el = document.getElementById(id); if (!el || !window.Chart) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new window.Chart(el, cfg);
  }
  const alpha = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

  // ---------- small builders ----------
  const kpi = (label, value, sub, cls = '') => `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub ${cls}">${sub}</div>` : ''}</div>`;
  const icon = { good: '✓', warn: '!', bad: '!', info: 'i' };
  const insightList = (list, showDomain) => `<ul class="insights">${list.map((i) => `<li class="insight ${i.tone}"><span class="dot" aria-hidden="true">${icon[i.tone]}</span><div><p class="t">${showDomain ? `<span class="tag">${i.domain === 'career' ? 'career & goals' : i.domain}</span>` : ''}${esc(i.text)}</p><p class="d">${esc(i.detail)}</p></div></li>`).join('')}</ul>`;
  const insightCard = (title, list) => `<div class="card"><h2>${title}<small class="computed">Computed from data as of ${fmt.date(M.asOf)}</small></h2>${insightList(list)}</div>`;
  const chartCard = (title, id, sub = '', cls = '', boxCls = '') => `<div class="card ${cls}"><h2>${title}${sub ? `<small>${sub}</small>` : ''}</h2><div class="chart-box ${boxCls}"><canvas id="${id}" role="img" aria-label="${esc(title)} chart"></canvas></div></div>`;
  const pillFor = (c) => (c.overdue > c.targetEveryDays ? '<span class="pill bad">overdue</span>' : c.overdue > 0 ? '<span class="pill warn">due</span>' : '<span class="pill good">on track</span>');
  const lastDays = (n) => M.health.daily.slice(-n);

  // ---------- header / hero ----------
  function renderHero() {
    const p = M.profile;
    $('#avatar').textContent = initials(p.name);
    document.querySelectorAll('.avatar.twin').forEach((a) => (a.textContent = initials(p.name)));
    $('#pName').textContent = p.name;
    $('#personaNotice').textContent = p.name;
    $('#pMeta').textContent = `${p.age} · ${p.occupation} · ${p.city}`;
    $('#pBio').textContent = p.bio;
    $('#pAsOf').textContent = `Twin synced ${fmt.date(M.asOf)}, 2026 · ${M.persona.finance.transactions.length} transactions, ${M.health.daily.length} days of health logs, ${M.relationships.contacts.length} people`;
    $('#twinSub').textContent = `Answers from ${p.firstName}'s data`;
    const s = M.scores, C = 2 * Math.PI * 52, fg = $('#ringFg');
    fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C;
    fg.style.stroke = scoreColor(s.life);
    requestAnimationFrame(() => setTimeout(() => (fg.style.strokeDashoffset = C * (1 - s.life / 100)), 60));
    $('#lifeScore').textContent = s.life;
    $('#lifeRing').setAttribute('aria-label', `Life Score ${s.life} out of 100`);
    const rows = [['finance', 'Finance'], ['health', 'Health'], ['relationships', 'Relationships'], ['career', 'Career & goals']];
    $('#subscores').innerHTML = rows.map(([k, n]) => `<li><button type="button" data-goto="${k}" aria-label="${n} score ${s[k]}, open tab"><span>${n}</span><span class="bar"><i style="width:${s[k]}%;background:${scoreColor(s[k])}"></i></span><b>${s[k]}</b></button></li>`).join('');
  }

  // ---------- overview ----------
  function renderOverview(el) {
    const F = M.finance, H = M.health, R = M.relationships, C = M.career;
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Net worth', fmt.usd(F.netWorth), `${fmt.usd(F.liabilities)} debt`)}
        ${kpi('Saved in ' + F.monthName(F.last).slice(0, 3), (F.lastSavingsRate * 100).toFixed(0) + '%', '3-mo avg ' + (F.avgSavingsRate3 * 100).toFixed(0) + '%')}
        ${kpi('Sleep (14 nights)', H.sleep14.toFixed(1) + 'h', `${H.shortNights}/14 under 7h`, H.shortNights > 6 ? 'down' : '')}
        ${kpi('Blood pressure', `${Math.round(H.sys)}/${Math.round(H.dia)}`, H.bpCat, /Stage/.test(H.bpCat) ? 'warn' : '')}
        ${kpi('People overdue', R.overdue.length, `of ${R.contacts.length} you track`, R.overdue.length > 3 ? 'warn' : '')}
        ${kpi('Goal progress', Math.round(U.avg(C.goals.map((g) => g.progress))) + '%', `${C.goals.length} active goals`)}
      </div>
      <div class="card"><h2>Your twin's brief<small class="computed">Top item from each area, ranked by urgency</small></h2>${insightList(INS.brief, true)}</div>
      <div class="grid-2">
        ${chartCard('Life balance', 'chRadar', 'Score by area, 0–100')}
        <div class="card"><h2>Coming up<small>next 60 days</small></h2><ul class="dates">${R.upcoming.filter((e) => e.inDays <= 60).map((e) => { const d = U.toDate(e.date); return `<li><div class="cal"><b>${d.toLocaleString('en-US', { month: 'short' })}</b><span>${d.getDate()}</span></div><div><strong>${esc(e.label)}</strong><div class="muted" style="font-size:.8rem">in ${fmt.days(e.inDays)}</div></div></li>`; }).join('')}</ul></div>
      </div>
      <div class="card"><h2>Habits, last 30 days<small>${Math.round(M.habits.rate14 * 100)}% done in the last 2 weeks</small></h2>
        <div class="heat">${M.habits.list.map((h) => `<span class="hn" title="${esc(h.name)}">${esc(h.name)}</span>${h.log.map((x) => `<i class="${x.done ? 'on' : ''}" title="${x.date}: ${x.done ? 'done' : 'missed'}"></i>`).join('')}`).join('')}</div>
      </div>`;
    const s = M.scores;
    chart('chRadar', { type: 'radar', data: { labels: ['Finance', 'Health', 'Relationships', 'Career & goals'],
      datasets: [{ label: 'Score', data: [s.finance, s.health, s.relationships, s.career], backgroundColor: alpha('#7c5cff', 0.22), borderColor: '#7c5cff', pointBackgroundColor: '#7c5cff', pointRadius: 3, tension: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: css('--border') }, angleLines: { color: css('--border') }, pointLabels: { color: css('--text'), font: { size: 12, weight: 600 } } } } } });
  }

  // ---------- finance ----------
  function renderFinance(el) {
    const F = M.finance, L = F.last;
    const lastSpend = F.spend(L), prevSpend = F.spend(F.prev), ch = U.pct(lastSpend, prevSpend);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Net worth', fmt.usd(F.netWorth), `${fmt.pct(U.pct(F.netWorthHistory.at(-1).netWorth, F.netWorthHistory.at(-4).netWorth), 1)} in 3 months`, 'up')}
        ${kpi(F.monthName(L) + ' spending', fmt.usd(lastSpend), `${fmt.pct(ch)} vs ${F.monthName(F.prev).slice(0, 3)}`, ch > 0 ? 'down' : 'up')}
        ${kpi('Savings rate', (F.lastSavingsRate * 100).toFixed(0) + '%', 'of take-home, ' + F.monthName(L).slice(0, 3))}
        ${kpi('Emergency fund', F.efundMonths.toFixed(1) + ' mo', 'goal 6 months', F.efundMonths < 6 ? 'warn' : 'up')}
        ${kpi('Credit score', F.creditNow, `+${F.creditNow - F.credit12} in 12 mo`, 'up')}
      </div>
      ${insightCard('Twin insights · Finance', E.insights.financeInsights(M))}
      ${chartCard('Monthly spending by category', 'chSpend', `${U.monthLabel(F.fullMonths[0])}–${U.monthLabel(F.fullMonths.at(-1))} 2026, excl. savings & debt payments`, '', 'tall')}
      <div class="grid-2">
        ${chartCard(F.monthName(L) + ' breakdown', 'chDonut', fmt.usd(lastSpend) + ' total')}
        ${chartCard('Budget vs actual', 'chBudget', F.monthName(L))}
        ${chartCard('Credit score', 'chCredit', 'last 12 months')}
        ${chartCard('Net worth', 'chNW', 'last 12 months')}
      </div>
      <div class="grid-2">
        <div class="card"><h2>Accounts<small>${fmt.usd(F.assets)}</small></h2><table class="tbl"><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody>${F.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${fmt.usd(a.balance)}</td></tr>`).join('')}</tbody></table></div>
        <div class="card"><h2>Debts<small>${fmt.usd(F.liabilities)}</small></h2><table class="tbl"><thead><tr><th>Debt</th><th class="num">APR</th><th class="num">Balance</th></tr></thead><tbody>${F.debts.slice().sort((a, b) => b.apr - a.apr).map((d) => `<tr><td>${esc(d.name)}${d.apr > 15 ? ' <span class="pill bad">high rate</span>' : ''}</td><td class="num">${d.apr}%</td><td class="num">${fmt.usd(d.balance)}</td></tr>`).join('')}</tbody></table></div>
      </div>
      <p class="disclaimer">${DISC.finance}</p>`;
    const cats = F.cats.slice().sort((a, b) => F.byMonthCat[L][b] - F.byMonthCat[L][a]);
    chart('chSpend', { type: 'bar', data: { labels: F.fullMonths.map(U.monthLabel), datasets: cats.map((c, i) => ({ label: c, data: F.fullMonths.map((m) => Math.round(F.byMonthCat[m][c])), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 2, stack: 's' })) },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt.usd(c.raw)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => '$' + v / 1000 + 'k' } } } } });
    const nonzero = cats.filter((c) => F.byMonthCat[L][c] > 0);
    chart('chDonut', { type: 'doughnut', data: { labels: nonzero, datasets: [{ data: nonzero.map((c) => Math.round(F.byMonthCat[L][c])), backgroundColor: nonzero.map((c) => PALETTE[cats.indexOf(c) % PALETTE.length]), borderColor: css('--card'), borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt.usd(c.raw)}` } } } } });
    const b = F.budgetLast.filter((x) => x.cat !== 'Housing');
    chart('chBudget', { type: 'bar', data: { labels: b.map((x) => x.cat), datasets: [
      { label: 'Budget', data: b.map((x) => x.budget), backgroundColor: alpha('#8e9ab3', 0.35) },
      { label: 'Actual', data: b.map((x) => Math.round(x.actual)), backgroundColor: b.map((x) => (x.actual > x.budget * 1.05 ? '#ef5168' : '#22c3a6')) }] },
      options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { ticks: { callback: (v) => '$' + v } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } } } });
    chart('chCredit', { type: 'line', data: { labels: F.credit.map((c) => U.monthLabel(c.month)), datasets: [{ label: 'Score', data: F.credit.map((c) => c.score), borderColor: '#22c3a6', backgroundColor: alpha('#22c3a6', 0.12), fill: true, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 690, suggestedMax: 760 }, x: { grid: { display: false } } } } });
    chart('chNW', { type: 'line', data: { labels: F.netWorthHistory.map((c) => U.monthLabel(c.month)), datasets: [{ label: 'Net worth', data: F.netWorthHistory.map((c) => c.netWorth), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.14), fill: true, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmt.usd(c.raw) } } }, scales: { y: { ticks: { callback: (v) => '$' + Math.round(v / 1000) + 'k' } }, x: { grid: { display: false } } } } });
  }

  // ---------- health ----------
  function renderHealth(el) {
    const H = M.health, d30 = lastDays(30), lbl = (arr) => arr.map((x) => fmt.date(x.date));
    const dw = H.wNow - H.w30;
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Sleep avg', H.sleep14.toFixed(1) + 'h', `${H.shortNights}/14 nights under 7h`, H.shortNights > 6 ? 'down' : '')}
        ${kpi('Steps / day', fmt.num(Math.round(H.steps7)), `goal ${fmt.num(H.goals.steps)}`, H.steps7 >= H.goals.steps ? 'up' : 'warn')}
        ${kpi('Weight', H.wNow.toFixed(1) + ' lb', `${dw <= 0 ? '' : '+'}${dw.toFixed(1)} lb vs a month ago`)}
        ${kpi('Blood pressure', `${Math.round(H.sys)}/${Math.round(H.dia)}`, H.bpCat + ' (3 wk avg)', /Stage/.test(H.bpCat) ? 'warn' : '')}
        ${kpi('Workouts / wk', H.workoutsPerWeek.toFixed(1), `goal ${H.goals.workoutsPerWeek}, was ${H.workoutsPerWeekPrev.toFixed(1)}`, H.workoutsPerWeek < H.goals.workoutsPerWeek ? 'down' : 'up')}
        ${kpi('Mood (1–5)', H.mood14.toFixed(1), `was ${H.moodPrev.toFixed(1)}`, H.mood14 < H.moodPrev ? 'down' : 'up')}
      </div>
      ${insightCard('Twin insights · Health', E.insights.healthInsights(M))}
      <div class="grid-2">
        ${chartCard('Sleep', 'chSleep', 'last 30 nights · goal ' + H.goals.sleepHours + 'h')}
        ${chartCard('Mood vs sleep', 'chMood', 'last 30 days')}
        ${chartCard('Steps', 'chSteps', 'last 30 days')}
        ${chartCard('Blood pressure', 'chBP', 'home readings, 90 days')}
        ${chartCard('Weight', 'chWeight', '90 days · goal ' + H.goals.targetWeightLb + ' lb')}
        ${chartCard('Workout minutes', 'chWorkouts', 'last 30 days by type')}
      </div>
      <p class="disclaimer">${DISC.health} Blood-pressure labels use American Heart Association adult categories and are shown for context only.</p>`;
    chart('chSleep', { type: 'bar', data: { labels: lbl(d30), datasets: [
      { type: 'line', label: 'Goal', data: d30.map(() => H.goals.sleepHours), borderColor: '#8e9ab3', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0 },
      { label: 'Hours', data: d30.map((x) => x.sleepHours), backgroundColor: d30.map((x) => (x.sleepHours < 7 ? alpha('#ef5168', 0.8) : alpha('#7c5cff', 0.85))) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 4, max: 9.5 }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    chart('chMood', { type: 'line', data: { labels: lbl(d30), datasets: [
      { label: 'Mood', data: d30.map((x) => x.mood), borderColor: '#f0a020', yAxisID: 'y', pointRadius: 2 },
      { label: 'Sleep (h)', data: d30.map((x) => x.sleepHours), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.1), fill: true, yAxisID: 'y1' }] },
      options: { plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false }, scales: { y: { min: 1, max: 5, title: { display: true, text: 'mood' } }, y1: { position: 'right', min: 4, max: 9.5, grid: { display: false }, title: { display: true, text: 'hours' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    chart('chSteps', { type: 'bar', data: { labels: lbl(d30), datasets: [
      { type: 'line', label: 'Goal', data: d30.map(() => H.goals.steps), borderColor: '#8e9ab3', borderDash: [5, 5], borderWidth: 1.5 },
      { label: 'Steps', data: d30.map((x) => x.steps), backgroundColor: d30.map((x) => (x.steps >= H.goals.steps ? alpha('#22c3a6', 0.85) : alpha('#22c3a6', 0.4))) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v) => v / 1000 + 'k' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    chart('chBP', { type: 'line', data: { labels: H.bp.map((x) => fmt.date(x.date)), datasets: [
      { label: 'Systolic', data: H.bp.map((x) => x.systolic), borderColor: '#ef5168', pointRadius: 2 },
      { label: 'Diastolic', data: H.bp.map((x) => x.diastolic), borderColor: '#4c8dff', pointRadius: 2 },
      { label: '120 / 80 reference', data: H.bp.map(() => 120), borderColor: alpha('#ef5168', 0.4), borderDash: [4, 4], borderWidth: 1 },
      { label: '', data: H.bp.map(() => 80), borderColor: alpha('#4c8dff', 0.4), borderDash: [4, 4], borderWidth: 1 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text } } }, scales: { y: { suggestedMin: 65, suggestedMax: 140 }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    chart('chWeight', { type: 'line', data: { labels: lbl(H.daily), datasets: [
      { label: 'Weight', data: H.daily.map((x) => x.weightLb), borderColor: alpha('#7c5cff', 0.35), borderWidth: 1, pointRadius: 0 },
      { label: '7-day avg', data: H.daily.map((_, i) => +U.avg(H.daily.slice(Math.max(0, i - 6), i + 1).map((x) => x.weightLb)).toFixed(1)), borderColor: '#7c5cff', borderWidth: 2.5 },
      { label: 'Goal', data: H.daily.map(() => H.goals.targetWeightLb), borderColor: '#8e9ab3', borderDash: [5, 5], borderWidth: 1.5 }] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    const wt = Object.entries(H.workoutTypes).sort((a, b) => b[1] - a[1]);
    chart('chWorkouts', { type: 'doughnut', data: { labels: wt.map((x) => x[0]), datasets: [{ data: wt.map((x) => x[1]), backgroundColor: PALETTE, borderColor: css('--card'), borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw} min` } } } } });
  }

  // ---------- relationships ----------
  function renderRelationships(el) {
    const R = M.relationships;
    const sorted = R.contacts.slice().sort((a, b) => b.overdue / b.targetEveryDays - a.overdue / a.targetEveryDays);
    const in30 = R.upcoming.filter((e) => e.inDays <= 30);
    const last4 = R.weeks.slice(4).reduce((s, w) => s + w.n, 0), prev4 = R.weeks.slice(0, 4).reduce((s, w) => s + w.n, 0);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('On track', `${R.onTrack}/${R.contacts.length}`, 'people at their rhythm')}
        ${kpi('Overdue', R.overdue.length, R.overdue[0] ? 'most: ' + E.who(R.overdue[0]) : '', 'warn')}
        ${kpi('Check-ins (4 wk)', last4, `was ${prev4}`, last4 < prev4 ? 'down' : 'up')}
        ${kpi('Dates in 30 days', in30.length, in30[0] ? in30[0].label.replace(/'s birthday/, ' bday') : '')}
      </div>
      ${insightCard('Twin insights · Relationships', E.insights.relationshipInsights(M))}
      <div class="grid-2">
        ${chartCard('Days since last contact', 'chSince', 'bar = days since · line = your target', '', 'tall')}
        ${chartCard('Check-ins per week', 'chWeeks', 'last 8 weeks, excluding partner', '', 'tall')}
      </div>
      <div class="card"><h2>People<small>sorted by who needs you most</small></h2><div class="people">${sorted.map((c) => `
        <div class="person"><div class="avatar" aria-hidden="true">${initials(c.name)}</div><div>
          <div class="nm"><span>${esc(c.name)}</span>${pillFor(c)}</div>
          <p>${esc(c.relation)} · last ${esc(c.last.type)} ${fmt.days(c.daysSince)} ago · aim every ${c.targetEveryDays}d</p>
          <p>${esc(c.notes)}</p></div></div>`).join('')}</div></div>
      <div class="card"><h2>Important dates</h2><ul class="dates">${R.upcoming.map((e) => { const d = U.toDate(e.date); return `<li><div class="cal"><b>${d.toLocaleString('en-US', { month: 'short' })}</b><span>${d.getDate()}</span></div><div><strong>${esc(e.label)}</strong><div class="muted" style="font-size:.8rem">in ${fmt.days(e.inDays)}</div></div></li>`; }).join('')}</ul></div>`;
    const cs = R.contacts.slice().sort((a, b) => b.daysSince - a.daysSince);
    chart('chSince', { type: 'bar', data: { labels: cs.map((c) => E.who(c)), datasets: [
      { label: 'Days since', data: cs.map((c) => c.daysSince), backgroundColor: cs.map((c) => (c.overdue > c.targetEveryDays ? '#ef5168' : c.overdue > 0 ? '#f0a020' : '#22c3a6')) },
      { type: 'line', label: 'Target', data: cs.map((c) => c.targetEveryDays), borderColor: css('--text'), borderWidth: 0, pointRadius: 5, pointStyle: 'line', pointBorderWidth: 2, showLine: false }] },
      options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { y: { grid: { display: false }, ticks: { autoSkip: false } } } } });
    chart('chWeeks', { type: 'bar', data: { labels: R.weeks.map((w) => 'wk of ' + w.label), datasets: [{ label: 'Check-ins', data: R.weeks.map((w) => w.n), backgroundColor: R.weeks.map((_, i) => (i >= 4 ? '#7c5cff' : alpha('#7c5cff', 0.45))) }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, callback: function (v) { return this.getLabelForValue(v).replace('wk of ', ''); } } }, y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  }

  // ---------- career & goals ----------
  function renderCareer(el) {
    const C = M.career;
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Salary', fmt.usd(C.salary), `${C.cagr.toFixed(1)}%/yr since ${C.salaryHistory[0].year}`)}
        ${kpi('vs market mid', fmt.pct(-C.gapPct), fmt.usd(C.marketRange.mid) + ' (demo)', C.gapPct > 5 ? 'warn' : 'up')}
        ${kpi('Review in', C.daysToReview + ' days', fmt.date(C.nextReview))}
        ${kpi('Deep work', C.deepNow.toFixed(1) + 'h/wk', `was ${C.deepBefore.toFixed(1)}h`, C.deepNow < C.deepBefore ? 'down' : 'up')}
        ${kpi('Habits (2 wk)', Math.round(M.habits.rate14 * 100) + '%', `was ${Math.round(M.habits.ratePrev * 100)}%`, M.habits.rate14 < M.habits.ratePrev ? 'down' : 'up')}
      </div>
      ${insightCard('Twin insights · Career & goals', E.insights.careerInsights(M))}
      <div class="grid-2">
        <div class="card"><h2>Goals</h2>${C.goals.map((g) => `<div class="goal"><div class="row"><strong>${esc(g.name)}</strong><span>${g.progress}%</span></div>
          <div class="bar"><i style="width:${g.progress}%;background:linear-gradient(90deg,var(--accent),var(--accent-2))"></i></div>
          <div class="meta">due ${fmt.date(g.due)} (${g.daysLeft} days)${g.milestones.length ? ` · ${g.done}/${g.milestones.length} milestones${g.next ? ' · next: ' + esc(g.next.name) : ''}` : ''}</div></div>`).join('')}</div>
        ${chartCard('Skills', 'chSkills', 'self-rated 1–10')}
        ${chartCard('Salary vs market', 'chSalary', 'market range is a demo benchmark')}
        ${chartCard('Deep work vs meetings', 'chFocus', 'hours per week')}
      </div>
      <div class="card"><h2>Habits<small>last 14 days vs the 2 weeks before</small></h2><table class="tbl"><thead><tr><th>Habit</th><th class="num">Last 14d</th><th class="num">Before</th><th class="num">Streak</th></tr></thead><tbody>
        ${M.habits.list.map((h) => `<tr><td>${esc(h.name)}</td><td class="num">${Math.round(h.rate14 * 100)}%</td><td class="num">${Math.round(h.ratePrev * 100)}%</td><td class="num">${h.streak}d</td></tr>`).join('')}</tbody></table></div>`;
    chart('chSkills', { type: 'radar', data: { labels: C.skills.map((s) => s.name), datasets: [{ label: 'Level', data: C.skills.map((s) => s.level), backgroundColor: alpha('#22c3a6', 0.2), borderColor: '#22c3a6', pointBackgroundColor: '#22c3a6', pointRadius: 3, tension: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 10, ticks: { display: false, stepSize: 2 }, grid: { color: css('--border') }, angleLines: { color: css('--border') }, pointLabels: { color: css('--text'), font: { size: 11 } } } } } });
    const yrs = C.salaryHistory.map((s) => String(s.year)).concat(['Market']);
    chart('chSalary', { type: 'line', data: { labels: C.salaryHistory.map((s) => s.year), datasets: [
      { label: 'Salary', data: C.salaryHistory.map((s) => s.salary), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.12), fill: true, pointRadius: 3 },
      { label: 'Market mid (2025)', data: C.salaryHistory.map(() => C.marketRange.mid), borderColor: '#f0a020', borderDash: [5, 5], borderWidth: 1.5 },
      { label: 'Market range', data: C.salaryHistory.map(() => C.marketRange.low), borderColor: alpha('#f0a020', 0.25), borderWidth: 1, fill: '+1', backgroundColor: alpha('#f0a020', 0.08) },
      { label: '', data: C.salaryHistory.map(() => C.marketRange.high), borderColor: alpha('#f0a020', 0.25), borderWidth: 1 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label || 'Market high'}: ${fmt.usd(c.raw)}` } } }, scales: { y: { ticks: { callback: (v) => '$' + v / 1000 + 'k' } }, x: { grid: { display: false } } } } });
    void yrs;
    chart('chFocus', { type: 'bar', data: { labels: C.focusHoursByWeek.map((w) => fmt.date(w.week)), datasets: [
      { label: 'Deep work', data: C.focusHoursByWeek.map((w) => w.deep), backgroundColor: '#22c3a6', stack: 'a' },
      { label: 'Meetings', data: C.focusHoursByWeek.map((w) => w.meetings), backgroundColor: alpha('#ef5168', 0.75), stack: 'a' }] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } }, y: { stacked: true } } } });
  }

  // ---------- tabs ----------
  const renderers = { overview: renderOverview, finance: renderFinance, health: renderHealth, relationships: renderRelationships, career: renderCareer };
  let current = 'overview';
  function show(tab, push = true) {
    if (!renderers[tab]) tab = 'overview';
    current = tab;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    Object.keys(renderers).forEach((k) => { $('#panel-' + k).hidden = k !== tab; });
    Object.keys(charts).forEach((k) => { charts[k].destroy(); delete charts[k]; });
    renderers[tab]($('#panel-' + tab));
    if (push) history.replaceState(null, '', '#' + tab);
  }
  document.querySelector('.tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) show(b.dataset.tab); });
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('.tab')], i = tabs.findIndex((t) => t.dataset.tab === current);
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; show(n.dataset.tab); n.focus();
  });
  $('#subscores').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) { show(b.dataset.goto); document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });

  // ---------- theme ----------
  $('#themeToggle').addEventListener('click', () => {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('evenself-theme', t); } catch (e) { /* private mode */ }
    document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#0b0f17' : '#f4f6fb';
    chartDefaults(); show(current, false);
  });

  // ---------- chat ----------
  const log = $('#chatLog'), input = $('#chatInput');
  const chatHistory = [];
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  function addMsg(role, html) { const d = document.createElement('div'); d.className = 'msg ' + role; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  async function ask(q) {
    q = q.trim(); if (!q) return;
    $('#chips').classList.add('compact'); addMsg('user', esc(q)); chatHistory.push({ role: 'user', content: q }); input.value = '';
    const t = addMsg('twin', '<span class="typing" aria-label="Twin is thinking"><i></i><i></i><i></i></span>');
    await new Promise((r) => setTimeout(r, 450 + Math.random() * 300));
    try {
      const r = await E.twin.askTwin(q, M, chatHistory);
      t.innerHTML = md(r.text) + (r.disclaimer ? `<span class="disc">${DISC[r.disclaimer]}</span>` : '');
      chatHistory.push({ role: 'assistant', content: r.text });
    } catch (err) { t.innerHTML = 'Sorry, something went wrong: ' + esc(err.message); }
    log.scrollTop = log.scrollHeight;
  }
  const CHIPS = ['How much did I spend on food?', 'Am I sleeping enough?', 'Who should I call this week?', 'Can I afford a $1,200 trip?', 'How am I doing overall?', "What's my blood pressure?", 'Should I ask for a raise?', 'How are my goals going?'];
  $('#chips').innerHTML = CHIPS.map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join('');
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) ask(c.textContent); });
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  addMsg('twin', md(`Hi ${M.profile.firstName}, I'm your twin. I've read ${M.persona.finance.transactions.length} transactions, ${M.health.daily.length} days of health logs and your contact history. Today's Life Score is **${M.scores.life}**. Ask me anything, or tap a suggestion.`));
  // mobile sheet
  const openChat = () => { document.body.classList.add('chat-open'); setTimeout(() => input.focus({ preventScroll: true }), 300); };
  const closeChat = () => document.body.classList.remove('chat-open');
  $('#chatFab').addEventListener('click', openChat);
  $('#chatClose').addEventListener('click', closeChat);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });
  document.addEventListener('click', (e) => { if (document.body.classList.contains('chat-open') && !e.target.closest('.chat') && !e.target.closest('.fab')) closeChat(); });

  // test hook for screenshots / automation
  window.EvenselfApp = { model: M, show, ask, openChat };

  chartDefaults();
  renderHero();
  show((location.hash || '#overview').slice(1), false);
})();
