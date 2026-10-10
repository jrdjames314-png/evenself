/* Evenself: UI. Renders the twin model (demo persona or the visitor's own data) into panels + charts and wires up the chat.
   One code path for both modes: data -> store.toInput (user only) -> analytics.buildModel -> insights / charts / chat. */
(function () {
  'use strict';
  const E = window.Evenself, { fmt } = E, U = E.util, S = E.store, ok = U.ok;
  let M = null, INS = null, mode = 'demo';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = (n) => String(n || '?').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const scoreColor = (s) => (!ok(s) ? 'var(--muted)' : s >= 75 ? 'var(--good)' : s >= 55 ? 'var(--warn)' : 'var(--bad)');
  const DISC = {
    finance: 'Not financial advice. Numbers come from the data in this view; talk to a qualified professional before making money decisions.',
    health: 'Not medical advice. Check any health concern with a licensed clinician; this tool only summarizes what was logged.',
  };
  E.DISC = DISC;

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
  const kpi = (label, value, sub, cls = '', action) => action && (value === null || value === '–')
    ? `<button type="button" class="kpi kpi-empty" data-action="${action}"><div class="label">${label}</div><div class="value">–</div><div class="sub">${sub || 'Add data'} →</div></button>`
    : `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub ${cls}">${sub}</div>` : ''}</div>`;
  const icon = { good: '✓', warn: '!', bad: '!', info: 'i', lock: '+' };
  const insightList = (list, showDomain) => `<ul class="insights">${list.map((i) => `<li class="insight ${i.tone}"><span class="dot" aria-hidden="true">${icon[i.tone]}</span><div><p class="t">${showDomain ? `<span class="tag">${i.domain === 'career' ? 'career & goals' : i.domain}</span>` : ''}${esc(i.text)}</p>${i.detail ? `<p class="d">${esc(i.detail)}</p>` : ''}${i.action && mode === 'user' ? `<button type="button" class="link-btn" data-action="${i.action}">${actionLabel(i.action)} →</button>` : ''}</div></li>`).join('')}</ul>`;
  const ACTION_LABELS = { 'add-tx': 'Add a transaction', checkin: 'Daily check-in', 'add-person': 'Add a person', 'log-contact': 'Log contact', 'add-goal': 'Add a goal', 'edit-finance': 'Edit money details', 'edit-habits': 'Edit habits', 'edit-health': 'Edit health goals', 'import-csv': 'Import CSV' };
  const actionLabel = (a) => ACTION_LABELS[a] || 'Add';
  const insightCard = (title, list) => `<div class="card"><h2>${title}<small class="computed">Computed from ${M.isDemo ? 'data' : 'your data'} as of ${fmt.date(M.asOf)}</small></h2>${insightList(list)}</div>`;
  const chartCard = (title, id, sub = '', cls = '', boxCls = '') => `<div class="card ${cls}"><h2>${title}${sub ? `<small>${sub}</small>` : ''}</h2><div class="chart-box ${boxCls}"><canvas id="${id}" role="img" aria-label="${esc(title)} chart"></canvas></div></div>`;
  const emptyCard = (title, msg, action, cls = '') => `<div class="card empty ${cls}"><h2>${title}</h2><div class="empty-body"><span class="empty-ico" aria-hidden="true">+</span><p>${msg}</p>${action && mode === 'user' ? `<button type="button" class="btn sm" data-action="${action}">${actionLabel(action)}</button>` : ''}</div></div>`;
  /** chart card if `cond`, otherwise an "add X to unlock" card */
  const maybeChart = (cond, title, id, sub, emptyMsg, action, boxCls = '') => (cond ? chartCard(title, id, sub, '', boxCls) : emptyCard(title, emptyMsg, action));
  const pillFor = (c) => (c.neverLogged && c.overdue <= 0 ? '<span class="pill info">new</span>' : c.overdue > c.targetEveryDays ? '<span class="pill bad">overdue</span>' : c.overdue > 0 ? '<span class="pill warn">due</span>' : '<span class="pill good">on track</span>');
  const userBtn = (action, label, id, cls = 'link-btn') => (mode === 'user' ? `<button type="button" class="${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${label}</button>` : '');

  // ---------- header / hero ----------
  function renderHero() {
    const p = M.profile;
    $('#avatar').textContent = initials(p.name);
    document.querySelectorAll('.avatar.twin').forEach((a) => (a.textContent = initials(p.name)));
    $('#pName').textContent = p.name;
    $('#pMeta').textContent = [p.age ? p.age : null, p.occupation, p.city].filter(Boolean).join(' · ') || (mode === 'user' ? 'Add your age, job and city in Edit profile' : '');
    $('#pBio').textContent = p.bio || '';
    if (M.isDemo) $('#pAsOf').textContent = `Twin synced ${fmt.date(M.asOf)}, 2026 · ${M.persona.finance.transactions.length} transactions, ${M.health.daily.length} days of health logs, ${M.relationships.contacts.length} people`;
    else $('#pAsOf').textContent = `Your twin · ${M.finance.has.txCount} transactions, ${M.health.daily.length} check-ins, ${M.relationships.contacts.length} people, ${M.career.goals.length} goals · stored only in this browser`;
    $('#editProfile').hidden = mode !== 'user';
    $('#twinSub').textContent = M.isDemo ? `Answers from ${p.firstName}'s data` : 'Answers from your data on this device';
    const s = M.scores, C = 2 * Math.PI * 52, fg = $('#ringFg');
    fg.style.strokeDasharray = C; fg.style.strokeDashoffset = C;
    fg.style.stroke = scoreColor(s.life);
    requestAnimationFrame(() => setTimeout(() => (fg.style.strokeDashoffset = C * (1 - (s.life || 0) / 100)), 60));
    $('#lifeScore').textContent = ok(s.life) ? s.life : '–';
    $('#lifeRing').setAttribute('aria-label', ok(s.life) ? `Life Score ${s.life} out of 100` : 'Life Score needs more data');
    $('#lifeNote').textContent = !ok(s.life) ? 'Add data to unlock' : M.areas < 4 ? `from ${M.areas} of 4 areas` : '';
    const rows = [['finance', 'Finance'], ['health', 'Health'], ['relationships', 'Relationships'], ['career', 'Career & goals']];
    $('#subscores').innerHTML = rows.map(([k, n]) => `<li><button type="button" data-goto="${k}" aria-label="${n} score ${ok(s[k]) ? s[k] : 'needs data'}, open tab"><span>${n}</span><span class="bar"><i style="width:${s[k] || 0}%;background:${scoreColor(s[k])}"></i></span><b>${ok(s[k]) ? s[k] : '–'}</b></button></li>`).join('');
  }

  function renderChrome() {
    document.body.dataset.mode = mode;
    const d = S.get();
    $('#modeDemo').setAttribute('aria-pressed', String(mode === 'demo'));
    $('#modeUser').setAttribute('aria-pressed', String(mode === 'user'));
    $('#modeUser').textContent = d && d.onboarded ? 'My data' : 'Create my twin';
    $('#addBtn').hidden = mode !== 'user';
    $('#modeBadge').textContent = mode === 'demo' ? 'Demo · fictional data' : 'Private · on this device';
    $('#modeBadge').className = 'demo-badge ' + (mode === 'demo' ? '' : 'private');
    const ai = S.getAI();
    const aiNote = ai.provider === 'gemini' || ai.provider === 'groq' ? ` AI chat is set to ${ai.provider === 'gemini' ? 'Gemini' : 'Groq'}: when you ask a question, that question plus a summary of your stats goes to that provider with your own key.` : '';
    $('#notice').innerHTML = mode === 'demo'
      ? `<strong>Fictional persona.</strong> ${esc(M.profile.name)} isn't a real person, and every number here is generated for this demo. Nothing on this page is medical or financial advice. <button type="button" class="link-btn" data-action="create">Create your own twin →</button>`
      : `<strong>Your data stays on this device.</strong> It's saved only in this browser's local storage and never uploaded; there are no accounts, analytics or trackers.${esc(aiNote)} Not medical or financial advice. <button type="button" class="link-btn" data-action="goto-data">Privacy &amp; backup →</button>`;
    $('#footDemo').hidden = mode !== 'demo';
    $('#footUser').hidden = mode !== 'user';
  }

  // ---------- overview ----------
  function renderOverview(el) {
    const F = M.finance, H = M.health, R = M.relationships, C = M.career;
    const goalsAvg = C.goals.length ? Math.round(U.avg(C.goals.map((g) => g.progress))) + '%' : null;
    const rateLbl = F.rateBasis === 'projected' ? 'Saving (on pace)' : 'Saved in ' + F.monthName(F.last).slice(0, 3);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Net worth', F.has.accounts || F.has.debts ? fmt.usd(F.netWorth) : null, F.has.accounts || F.has.debts ? `${fmt.usd(F.liabilities)} debt` : 'Add savings & debts', '', 'edit-finance')}
        ${kpi(rateLbl, ok(F.rateNow) ? (F.rateNow * 100).toFixed(0) + '%' : null, ok(F.avgSavingsRate3) ? '3-mo avg ' + (F.avgSavingsRate3 * 100).toFixed(0) + '%' : F.rateBasis === 'projected' ? 'projected this month' : 'Add income & spending', '', 'add-tx')}
        ${kpi(`Sleep (${M.isDemo ? 14 : H.nights14} night${H.nights14 === 1 ? '' : 's'})`, ok(H.sleep14) ? H.sleep14.toFixed(1) + 'h' : null, ok(H.sleep14) ? `${H.shortNights}/${H.nights14} under 7h` : 'Do a check-in', H.shortNights > H.nights14 * 0.43 ? 'down' : '', 'checkin')}
        ${ok(H.sys) || M.isDemo ? kpi('Blood pressure', `${Math.round(H.sys)}/${Math.round(H.dia)}`, H.bpCat, /Stage/.test(H.bpCat) ? 'warn' : '')
          : kpi('Mood (2 wk)', ok(H.mood14) ? H.mood14.toFixed(1) + '/5' : null, ok(H.energy14) ? `energy ${H.energy14.toFixed(1)}/5` : 'Rate it in a check-in', '', 'checkin')}
        ${kpi('People overdue', R.has.any ? R.overdue.length : null, R.has.any ? `of ${R.contacts.length} you track` : 'Add people', R.overdue.length > 3 ? 'warn' : '', 'add-person')}
        ${kpi('Goal progress', goalsAvg, C.goals.length ? `${C.goals.length} active goal${C.goals.length > 1 ? 's' : ''}` : 'Add a goal', '', 'add-goal')}
      </div>
      ${mode === 'user' ? quickActions() : ''}
      <div class="card"><h2>Your twin's brief<small class="computed">Top item from each area, ranked by urgency</small></h2>${insightList(INS.brief, true)}</div>
      <div class="grid-2">
        ${M.areas >= 2 ? chartCard('Life balance', 'chRadar', 'Score by area, 0–100') : emptyCard('Life balance', 'Fill in at least two areas (money, health check-ins, people or goals) to see how they balance.', 'checkin')}
        ${R.upcoming.filter((e) => e.inDays <= 60).length ? `<div class="card"><h2>Coming up<small>next 60 days</small></h2><ul class="dates">${R.upcoming.filter((e) => e.inDays <= 60).map(dateLi).join('')}</ul></div>`
          : emptyCard('Coming up', 'Birthdays you add for the people in your life show up here.', 'add-person')}
      </div>
      ${M.habits.list.length ? `<div class="card"><h2>Habits, last 30 days<small>${ok(M.habits.rate14) ? Math.round(M.habits.rate14 * 100) + '% done in the last 2 weeks' : 'tick them off in your check-in'}</small></h2>${heat()}</div>`
        : emptyCard('Habits, last 30 days', 'Add a habit or two (like "Walk 20 minutes") and tick them off in your daily check-in to build streaks.', 'edit-habits')}`;
    const s = M.scores;
    chart('chRadar', { type: 'radar', data: { labels: ['Finance', 'Health', 'Relationships', 'Career & goals'],
      datasets: [{ label: 'Score', data: [s.finance, s.health, s.relationships, s.career].map((x) => (ok(x) ? x : 0)), backgroundColor: alpha('#7c5cff', 0.22), borderColor: '#7c5cff', pointBackgroundColor: '#7c5cff', pointRadius: 3, tension: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 100, ticks: { display: false, stepSize: 25 }, grid: { color: css('--border') }, angleLines: { color: css('--border') }, pointLabels: { color: css('--text'), font: { size: 12, weight: 600 } } } } } });
  }
  const dateLi = (e) => { const d = U.toDate(e.date); return `<li><div class="cal"><b>${d.toLocaleString('en-US', { month: 'short' })}</b><span>${d.getDate()}</span></div><div><strong>${esc(e.label)}</strong><div class="muted" style="font-size:.8rem">in ${fmt.days(e.inDays)}</div></div></li>`; };
  function heat() {
    const days = []; for (let i = 29; i >= 0; i--) days.push(S.shiftISO(M.asOf, -i));
    return `<div class="heat">${M.habits.list.map((h) => { const by = Object.fromEntries(h.log.map((x) => [x.date, x.done]));
      return `<span class="hn" title="${esc(h.name)}">${esc(h.name)}</span>${days.map((dt) => (dt in by ? `<i class="${by[dt] ? 'on' : ''}" title="${dt}: ${by[dt] ? 'done' : 'missed'}"></i>` : `<i class="na" title="${dt}: not tracked"></i>`)).join('')}`; }).join('')}</div>`;
  }
  const quickActions = () => `<div class="quick" role="group" aria-label="Quick add">
      <button type="button" class="qa" data-action="add-tx"><span>$</span>Transaction</button>
      <button type="button" class="qa" data-action="checkin"><span>☾</span>Check-in</button>
      <button type="button" class="qa" data-action="log-contact"><span>☏</span>Log contact</button>
      <button type="button" class="qa" data-action="goal-progress"><span>◎</span>Goal progress</button>
      <button type="button" class="qa" data-action="import-csv"><span>⇪</span>Import CSV</button></div>`;

  // ---------- finance ----------
  function renderFinance(el) {
    const F = M.finance, L = F.last;
    const lastSpend = F.has.last ? F.spend(L) : null, prevSpend = F.has.prev ? F.spend(F.prev) : null, ch = ok(lastSpend) && prevSpend ? U.pct(lastSpend, prevSpend) : null;
    const nwH = F.netWorthHistory;
    const shownMonths = M.isDemo ? F.fullMonths : F.months.filter((m) => F.spend(m) > 0);
    const BM = F.budgetMonth, bmName = F.monthName(BM) + (F.budgetPartial ? ' so far' : '');
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Net worth', F.has.accounts || F.has.debts ? fmt.usd(F.netWorth) : null, nwH.length >= 4 ? `${fmt.pct(U.pct(nwH.at(-1).netWorth, nwH.at(-4).netWorth), 1)} in 3 months` : F.has.accounts || F.has.debts ? `${fmt.usd(F.assets)} assets` : 'Add balances', nwH.length >= 4 ? 'up' : '', 'edit-finance')}
        ${ok(lastSpend) ? kpi(F.monthName(L) + ' spending', fmt.usd(lastSpend), ok(ch) ? `${fmt.pct(ch)} vs ${F.monthName(F.prev).slice(0, 3)}` : '', ch > 0 ? 'down' : 'up')
          : kpi(F.monthName(F.cur) + ' so far', F.has.tx ? fmt.usd(F.spend(F.cur)) : null, F.has.tx ? `${F.has.txCount} logged + recurring` : 'Log spending', '', 'add-tx')}
        ${kpi('Savings rate', ok(F.rateNow) ? (F.rateNow * 100).toFixed(0) + '%' : null, F.rateBasis === 'last' ? 'of take-home, ' + F.monthName(L).slice(0, 3) : F.rateBasis === 'projected' ? 'projected this month' : 'Add income', '', 'edit-finance')}
        ${kpi('Emergency fund', ok(F.efundMonths) ? F.efundMonths.toFixed(1) + ' mo' : null, ok(F.efundMonths) ? `goal ${M.persona.finance.emergencyFundTargetMonths || 6} months` : 'Add savings', F.efundMonths < 6 ? 'warn' : 'up', 'edit-finance')}
        ${kpi('Credit score', ok(F.creditNow) ? F.creditNow : null, F.credit.length > 1 ? `${F.creditNow >= F.credit12 ? '+' : ''}${F.creditNow - F.credit12} in ${F.credit.length >= 12 ? 12 : F.credit.length - 1} mo` : ok(F.creditNow) ? 'update monthly' : 'optional', 'up', 'edit-finance')}
      </div>
      ${insightCard('Twin insights · Finance', E.insights.financeInsights(M))}
      ${maybeChart(shownMonths.length > 0, 'Monthly spending by category', 'chSpend', M.isDemo ? `${U.monthLabel(F.fullMonths[0])}–${U.monthLabel(F.fullMonths.at(-1))} 2026, excl. savings & debt payments` : 'excl. savings & debt payments; this month is so far',
        'Log a few transactions or import a CSV from your bank to see where your money goes each month.', 'add-tx', 'tall')}
      <div class="grid-2">
        ${maybeChart(F.spend(BM) > 0, (F.budgetPartial ? F.monthName(BM) + ' so far' : F.monthName(BM) + ' breakdown'), 'chDonut', fmt.usd(F.spend(BM)) + ' total', 'Your spending by category appears here once you log some.', 'add-tx')}
        ${maybeChart(F.budgetLast.length > 0, 'Budget vs actual', 'chBudget', bmName, 'Set monthly budgets for a few categories to compare against what you actually spend.', 'edit-finance')}
        ${maybeChart(F.credit.length >= 2, 'Credit score', 'chCredit', M.isDemo ? 'last 12 months' : 'monthly', ok(F.creditNow) ? `Score ${F.creditNow} saved. Update it next month to start a trend line.` : 'Optional: add your credit score and update it monthly to see the trend.', 'edit-finance')}
        ${maybeChart(nwH.length >= 2, 'Net worth', 'chNW', M.isDemo ? 'last 12 months' : 'recorded monthly from your balances', F.has.accounts || F.has.debts ? `${fmt.usd(F.netWorth)} recorded for ${F.monthName(F.cur)}. Update balances next month to see the trend.` : 'Add savings, investments and debts to track net worth over time.', 'edit-finance')}
      </div>
      <div class="grid-2">
        ${F.accounts.length ? `<div class="card"><h2>Accounts<small>${fmt.usd(F.assets)}</small></h2><table class="tbl"><thead><tr><th>Account</th><th class="num">Balance</th></tr></thead><tbody>${F.accounts.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${fmt.usd(a.balance)}</td></tr>`).join('')}</tbody></table>${userBtn('edit-finance', 'Update balances →')}</div>`
          : emptyCard('Accounts', 'Add checking, savings, emergency fund and investments to see net worth and "can I afford it?" answers.', 'edit-finance')}
        ${F.debts.length ? `<div class="card"><h2>Debts<small>${fmt.usd(F.liabilities)}</small></h2><table class="tbl"><thead><tr><th>Debt</th><th class="num">APR</th><th class="num">Balance</th></tr></thead><tbody>${F.debts.slice().sort((a, b) => b.apr - a.apr).map((d) => `<tr><td>${esc(d.name)}${d.apr > 15 ? ' <span class="pill bad">high rate</span>' : ''}</td><td class="num">${d.apr}%</td><td class="num">${fmt.usd(d.balance)}</td></tr>`).join('')}</tbody></table>${userBtn('edit-finance', 'Update debts →')}</div>`
          : emptyCard('Debts', mode === 'user' ? 'No debts added. If you have a card balance or loan, add it (with its APR) to see which to pay first.' : 'No debts.', 'edit-finance')}
      </div>
      ${mode === 'user' ? recentTx() : ''}
      <p class="disclaimer">${DISC.finance}</p>`;
    const cats = F.cats.slice().sort((a, b) => (F.byMonthCat[BM][b] || 0) - (F.byMonthCat[BM][a] || 0)).filter((c) => M.isDemo || shownMonths.some((m) => F.byMonthCat[m][c] > 0));
    const mLabel = (m) => U.monthLabel(m) + (m === F.cur && !M.isDemo ? ' (so far)' : '');
    chart('chSpend', { type: 'bar', data: { labels: shownMonths.map(mLabel), datasets: cats.map((c, i) => ({ label: c, data: shownMonths.map((m) => Math.round(F.byMonthCat[m][c] || 0)), backgroundColor: PALETTE[i % PALETTE.length], borderRadius: 2, stack: 's' })) },
      options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt.usd(c.raw)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => (v >= 1000 ? '$' + v / 1000 + 'k' : '$' + v) } } } } });
    const nonzero = cats.filter((c) => (F.byMonthCat[BM][c] || 0) > 0);
    chart('chDonut', { type: 'doughnut', data: { labels: nonzero, datasets: [{ data: nonzero.map((c) => Math.round(F.byMonthCat[BM][c])), backgroundColor: nonzero.map((c) => PALETTE[cats.indexOf(c) % PALETTE.length]), borderColor: css('--card'), borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: window.innerWidth < 520 ? 'bottom' : 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt.usd(c.raw)}` } } } } });
    const b = F.budgetLast.filter((x) => !M.isDemo || x.cat !== 'Housing');
    chart('chBudget', { type: 'bar', data: { labels: b.map((x) => x.cat), datasets: [
      { label: 'Budget', data: b.map((x) => x.budget), backgroundColor: alpha('#8e9ab3', 0.35) },
      { label: 'Actual', data: b.map((x) => Math.round(x.actual)), backgroundColor: b.map((x) => (x.actual > x.budget * 1.05 ? '#ef5168' : '#22c3a6')) }] },
      options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { ticks: { callback: (v) => '$' + v } }, y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } } } });
    const cs = F.credit.map((c) => c.score);
    chart('chCredit', { type: 'line', data: { labels: F.credit.map((c) => U.monthLabel(c.month)), datasets: [{ label: 'Score', data: cs, borderColor: '#22c3a6', backgroundColor: alpha('#22c3a6', 0.12), fill: true, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: M.isDemo ? { suggestedMin: 690, suggestedMax: 760 } : { suggestedMin: Math.min(...cs) - 20, suggestedMax: Math.max(...cs) + 20 }, x: { grid: { display: false } } } } });
    chart('chNW', { type: 'line', data: { labels: nwH.map((c) => U.monthLabel(c.month)), datasets: [{ label: 'Net worth', data: nwH.map((c) => c.netWorth), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.14), fill: true, pointRadius: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmt.usd(c.raw) } } }, scales: { y: { ticks: { callback: (v) => (Math.abs(v) >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + v) } }, x: { grid: { display: false } } } } });
  }
  function recentTx() {
    const d = S.get(); const list = d ? d.finance.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8) : [];
    if (!list.length) return emptyCard('Recent transactions', 'Nothing logged yet. Recurring bills you entered are counted automatically each month.', 'add-tx');
    return `<div class="card"><h2>Recent transactions<small><button type="button" class="link-btn" data-action="goto-data">See all &amp; edit</button></small></h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Note</th><th class="hide-sm">Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${list.map((t) => `<tr><td class="nowrap">${fmt.date(t.date)}</td><td class="trunc">${esc(t.note || '')}<span class="sub-sm">${esc(t.category)}</span></td><td class="hide-sm">${esc(t.category)}</td><td class="num ${t.category === 'Income' ? 'pos' : ''}">${t.category === 'Income' ? '+' : ''}${fmt.usd(t.amount, 2)}</td><td class="num"><button type="button" class="icon-sm" data-action="edit-tx" data-id="${t.id}" aria-label="Edit transaction">✎</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- health ----------
  function renderHealth(el) {
    const H = M.health, u = H.unit || 'lb';
    const d30 = M.isDemo ? H.daily.slice(-30) : H.l30;
    const lbl = (arr) => arr.map((x) => fmt.date(x.date));
    const has = (k, arr = d30) => arr.filter((x) => ok(x[k])).length;
    const dw = ok(H.wNow) && ok(H.w30) ? H.wNow - H.w30 : null;
    const weighed = H.daily.filter((x) => ok(x.weightLb));
    el.innerHTML = `
      <div class="kpis">
        ${kpi('Sleep avg', ok(H.sleep14) ? H.sleep14.toFixed(1) + 'h' : null, ok(H.sleep14) ? `${H.shortNights}/${H.nights14} nights under 7h` : 'Do a check-in', H.shortNights > H.nights14 * 0.43 ? 'down' : '', 'checkin')}
        ${kpi('Steps / day', ok(H.steps7) ? fmt.num(Math.round(H.steps7)) : null, ok(H.steps7) ? `goal ${fmt.num(H.goals.steps)}` : 'Log steps', H.steps7 >= H.goals.steps ? 'up' : 'warn', 'checkin')}
        ${kpi('Weight', ok(H.wNow) ? H.wNow.toFixed(1) + ' ' + u : null, ok(dw) ? `${dw <= 0 ? '' : '+'}${dw.toFixed(1)} ${u} vs a month ago` : ok(H.goals.targetWeightLb) ? `goal ${H.goals.targetWeightLb} ${u}` : ok(H.wNow) ? '7-day average' : 'optional', '', 'checkin')}
        ${kpi('Blood pressure', ok(H.sys) ? `${Math.round(H.sys)}/${Math.round(H.dia)}` : null, ok(H.sys) ? H.bpCat + ' (3 wk avg)' : 'optional', /Stage/.test(H.bpCat) ? 'warn' : '', 'checkin')}
        ${M.isDemo ? kpi('Workouts / wk', H.workoutsPerWeek.toFixed(1), `goal ${H.goals.workoutsPerWeek}, was ${H.workoutsPerWeekPrev.toFixed(1)}`, H.workoutsPerWeek < H.goals.workoutsPerWeek ? 'down' : 'up')
          : kpi('Energy (1–5)', ok(H.energy14) ? H.energy14.toFixed(1) : null, ok(H.energy14) ? 'last 2 weeks' : 'Rate it', '', 'checkin')}
        ${kpi('Mood (1–5)', ok(H.mood14) ? H.mood14.toFixed(1) : null, ok(H.moodPrev) ? `was ${H.moodPrev.toFixed(1)}` : ok(H.mood14) ? 'last 2 weeks' : 'Rate it', H.mood14 < H.moodPrev ? 'down' : 'up', 'checkin')}
      </div>
      ${mode === 'user' ? `<div class="row-actions"><button type="button" class="btn" data-action="checkin">+ Daily check-in</button><button type="button" class="btn ghost" data-action="edit-health">Health goals</button></div>` : ''}
      ${insightCard('Twin insights · Health', E.insights.healthInsights(M))}
      <div class="grid-2">
        ${maybeChart(has('sleepHours') >= 2, 'Sleep', 'chSleep', `${M.isDemo ? 'last 30 nights' : 'last 30 days'} · goal ${H.goals.sleepHours}h`, 'Log sleep in 2+ check-ins to see your nights against your goal.', 'checkin')}
        ${maybeChart(has('mood') >= 2 && has('sleepHours') >= 2, 'Mood vs sleep', 'chMood', 'last 30 days', 'Two or more check-ins with sleep and mood show how one moves the other.', 'checkin')}
        ${maybeChart(has('steps') >= 2, 'Steps', 'chSteps', 'last 30 days', 'Log steps in 2+ check-ins (from your phone or watch) to see the trend.', 'checkin')}
        ${maybeChart(H.bp.length >= 2, 'Blood pressure', 'chBP', M.isDemo ? 'home readings, 90 days' : 'home readings', H.bp.length === 1 ? 'One reading saved. Add another to start the chart.' : 'Optional: add home blood-pressure readings in your check-in.', 'checkin')}
        ${maybeChart(weighed.length >= 2, 'Weight', 'chWeight', `${M.isDemo ? '90 days' : 'all check-ins'}${ok(H.goals.targetWeightLb) ? ' · goal ' + H.goals.targetWeightLb + ' ' + u : ''}`, 'Optional: add your weight in 2+ check-ins to see the trend.', 'checkin')}
        ${M.isDemo ? chartCard('Workout minutes', 'chWorkouts', 'last 30 days by type') : maybeChart(has('energy') >= 2, 'Energy', 'chEnergy', 'last 30 days, 1–5', 'Rate your energy in 2+ check-ins to see it next to your sleep.', 'checkin')}
      </div>
      ${mode === 'user' ? recentCheckins() : ''}
      <p class="disclaimer">${DISC.health} Blood-pressure labels use American Heart Association adult categories and are shown for context only.</p>`;
    const sleepY = M.isDemo ? { min: 4, max: 9.5 } : { suggestedMin: 4, suggestedMax: 9.5 };
    chart('chSleep', { type: 'bar', data: { labels: lbl(d30), datasets: [
      { type: 'line', label: 'Goal', data: d30.map(() => H.goals.sleepHours), borderColor: '#8e9ab3', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0 },
      { label: 'Hours', data: d30.map((x) => x.sleepHours), backgroundColor: d30.map((x) => (x.sleepHours < 7 ? alpha('#ef5168', 0.8) : alpha('#7c5cff', 0.85))) }] },
      options: { plugins: { legend: { display: false } }, scales: { y: sleepY, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    chart('chMood', { type: 'line', data: { labels: lbl(d30), datasets: [
      { label: 'Mood', data: d30.map((x) => x.mood), borderColor: '#f0a020', yAxisID: 'y', pointRadius: 2, spanGaps: true },
      { label: 'Sleep (h)', data: d30.map((x) => x.sleepHours), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.1), fill: true, yAxisID: 'y1', spanGaps: true, pointRadius: M.isDemo ? 0 : 2 }] },
      options: { plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false }, scales: { y: { min: 1, max: 5, title: { display: true, text: 'mood' } }, y1: { position: 'right', ...sleepY, grid: { display: false }, title: { display: true, text: 'hours' } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
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
    const W = M.isDemo ? H.daily : weighed;
    const wds = [
      { label: 'Weight', data: W.map((x) => x.weightLb), borderColor: alpha('#7c5cff', M.isDemo ? 0.35 : 0.6), borderWidth: M.isDemo ? 1 : 1.5, pointRadius: M.isDemo ? 0 : 2 },
      { label: '7-day avg', data: W.map((_, i) => +U.avg(W.slice(Math.max(0, i - 6), i + 1).map((x) => x.weightLb)).toFixed(1)), borderColor: '#7c5cff', borderWidth: 2.5 }];
    if (ok(H.goals.targetWeightLb)) wds.push({ label: 'Goal', data: W.map(() => H.goals.targetWeightLb), borderColor: '#8e9ab3', borderDash: [5, 5], borderWidth: 1.5 });
    chart('chWeight', { type: 'line', data: { labels: lbl(W), datasets: wds }, options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
    const wt = Object.entries(H.workoutTypes).sort((a, b) => b[1] - a[1]);
    chart('chWorkouts', { type: 'doughnut', data: { labels: wt.map((x) => x[0]), datasets: [{ data: wt.map((x) => x[1]), backgroundColor: PALETTE, borderColor: css('--card'), borderWidth: 2 }] },
      options: { cutout: '62%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw} min` } } } } });
    chart('chEnergy', { type: 'line', data: { labels: lbl(d30), datasets: [{ label: 'Energy', data: d30.map((x) => x.energy), borderColor: '#22c3a6', backgroundColor: alpha('#22c3a6', 0.12), fill: true, pointRadius: 2, spanGaps: true }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { min: 1, max: 5, ticks: { stepSize: 1 } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0 } } } } });
  }
  function recentCheckins() {
    const d = S.get(); const list = d ? d.health.checkins.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7) : [];
    if (!list.length) return '';
    const v = (x, suf = '') => (ok(x) ? x + suf : '–');
    return `<div class="card"><h2>Recent check-ins<small><button type="button" class="link-btn" data-action="goto-data">See all &amp; edit</button></small></h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="num">Sleep</th><th class="num">Steps</th><th class="num">Mood</th><th class="num">Energy</th><th class="num">Weight</th><th class="num">BP</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr><td>${fmt.date(c.date)}</td><td class="num">${v(c.sleep, 'h')}</td><td class="num">${ok(c.steps) ? fmt.num(c.steps) : '–'}</td><td class="num">${v(c.mood)}</td><td class="num">${v(c.energy)}</td><td class="num">${v(c.weight)}</td><td class="num">${c.sys && c.dia ? c.sys + '/' + c.dia : '–'}</td><td class="num"><button type="button" class="icon-sm" data-action="checkin" data-date="${c.date}" aria-label="Edit check-in ${c.date}">✎</button></td></tr>`).join('')}</tbody></table></div></div>`;
  }

  // ---------- relationships ----------
  function renderRelationships(el) {
    const R = M.relationships;
    const sorted = R.contacts.slice().sort((a, b) => b.overdue / b.targetEveryDays - a.overdue / a.targetEveryDays);
    const in30 = R.upcoming.filter((e) => e.inDays <= 30);
    const last4 = R.weeks.slice(4).reduce((s, w) => s + w.n, 0), prev4 = R.weeks.slice(0, 4).reduce((s, w) => s + w.n, 0);
    el.innerHTML = `
      <div class="kpis">
        ${kpi('On track', R.has.any ? `${R.onTrack}/${R.contacts.length}` : null, R.has.any ? 'people at their rhythm' : 'Add people', '', 'add-person')}
        ${kpi('Overdue', R.has.any ? R.overdue.length : null, R.overdue[0] ? 'most: ' + E.who(R.overdue[0]) : '', 'warn', 'add-person')}
        ${kpi('Check-ins (4 wk)', R.has.any ? last4 : null, R.has.any ? `was ${prev4}` : 'Log contact', last4 < prev4 ? 'down' : 'up', 'log-contact')}
        ${kpi('Dates in 30 days', R.has.any ? in30.length : null, in30[0] ? in30[0].label.replace(/'s birthday/, ' bday') : '', '', 'add-person')}
      </div>
      ${mode === 'user' ? `<div class="row-actions"><button type="button" class="btn" data-action="log-contact">+ Log contact</button><button type="button" class="btn ghost" data-action="add-person">Add person</button></div>` : ''}
      ${insightCard('Twin insights · Relationships', E.insights.relationshipInsights(M))}
      <div class="grid-2">
        ${maybeChart(R.has.any, 'Days since last contact', 'chSince', 'bar = days since · line = your target', 'Add people and how often you want to talk; the twin shows who you\'re drifting from.', 'add-person', 'tall')}
        ${maybeChart(R.has.logged > 0, 'Check-ins per week', 'chWeeks', 'last 8 weeks, excluding partner', 'Log calls, texts and meetups to see your weekly rhythm.', 'log-contact', 'tall')}
      </div>
      ${R.has.any ? `<div class="card"><h2>People<small>sorted by who needs you most</small></h2><div class="people">${sorted.map((c) => `
        <div class="person"><div class="avatar" aria-hidden="true">${initials(c.name)}</div><div>
          <div class="nm"><span>${esc(c.name)}</span>${pillFor(c)}</div>
          <p>${esc(c.relation)} · ${c.neverLogged ? 'no contact logged yet' : `last ${esc(c.last.type)} ${fmt.days(c.daysSince)} ago`} · aim every ${c.targetEveryDays}d</p>
          ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}${userBtn('log-contact', 'Log contact', c.id)}</div></div>`).join('')}</div></div>`
        : emptyCard('People', 'Nobody added yet.', 'add-person')}
      ${R.upcoming.length ? `<div class="card"><h2>Important dates</h2><ul class="dates">${R.upcoming.map(dateLi).join('')}</ul></div>` : emptyCard('Important dates', 'Add birthdays for the people in your life and they show up here with a heads-up.', 'add-person')}`;
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
    const C = M.career, HB = M.habits;
    const best = HB.list.slice().sort((a, b) => b.streak - a.streak)[0];
    const nextDue = C.goals.filter((g) => ok(g.daysLeft) && g.daysLeft >= 0 && g.progress < 100).sort((a, b) => a.daysLeft - b.daysLeft)[0];
    const kpis = M.isDemo || C.has.salary ? `
        ${kpi('Salary', fmt.usd(C.salary), ok(C.cagr) ? `${C.cagr.toFixed(1)}%/yr since ${C.salaryHistory[0].year}` : '')}
        ${kpi('vs market mid', fmt.pct(-C.gapPct), fmt.usd(C.marketRange.mid) + ' (demo)', C.gapPct > 5 ? 'warn' : 'up')}
        ${kpi('Review in', C.daysToReview + ' days', fmt.date(C.nextReview))}
        ${kpi('Deep work', C.deepNow.toFixed(1) + 'h/wk', `was ${C.deepBefore.toFixed(1)}h`, C.deepNow < C.deepBefore ? 'down' : 'up')}` : `
        ${kpi('Active goals', C.goals.length ? C.goals.filter((g) => g.progress < 100).length : null, C.goals.length ? `${C.goals.filter((g) => g.progress >= 100).length} complete` : 'Add a goal', '', 'add-goal')}
        ${kpi('Avg progress', C.goals.length ? Math.round(U.avg(C.goals.map((g) => g.progress))) + '%' : null, C.goals.length ? 'across all goals' : '', '', 'add-goal')}
        ${kpi('Next due', nextDue ? fmt.days(nextDue.daysLeft) : null, nextDue ? nextDue.name : 'Add target dates', '', 'add-goal')}
        ${kpi('Best streak', best ? best.streak + 'd' : null, best ? best.name : 'Add habits', '', 'edit-habits')}`;
    el.innerHTML = `
      <div class="kpis">${kpis}
        ${kpi('Habits (2 wk)', ok(HB.rate14) ? Math.round(HB.rate14 * 100) + '%' : null, ok(HB.ratePrev) ? `was ${Math.round(HB.ratePrev * 100)}%` : ok(HB.rate14) ? 'so far' : 'Tick them in check-ins', HB.rate14 < HB.ratePrev ? 'down' : 'up', HB.list.length ? 'checkin' : 'edit-habits')}
      </div>
      ${mode === 'user' ? `<div class="row-actions"><button type="button" class="btn" data-action="goal-progress">Update goal progress</button><button type="button" class="btn ghost" data-action="add-goal">Add goal</button><button type="button" class="btn ghost" data-action="edit-habits">Habits</button></div>` : ''}
      ${insightCard('Twin insights · Career & goals', E.insights.careerInsights(M))}
      <div class="grid-2">
        ${C.goals.length ? `<div class="card"><h2>Goals</h2>${C.goals.map((g) => `<div class="goal"><div class="row"><strong>${esc(g.name)}</strong><span>${g.progress}%</span></div>
          <div class="bar"><i style="width:${g.progress}%;background:linear-gradient(90deg,var(--accent),var(--accent-2))"></i></div>
          <div class="meta">${g.due ? `due ${fmt.date(g.due)} (${g.daysLeft >= 0 ? g.daysLeft + ' days' : -g.daysLeft + ' days ago'})` : 'no target date'}${g.area && !M.isDemo ? ' · ' + esc(g.area) : ''}${g.milestones.length ? ` · ${g.done}/${g.milestones.length} milestones${g.next ? ' · next: ' + esc(g.next.name) : ''}` : ''} ${userBtn('goal-progress', 'Update', g.id)}</div></div>`).join('')}</div>`
          : emptyCard('Goals', 'Add a goal with a target date (career, money, health or personal). Your twin tracks the pace.', 'add-goal')}
        ${C.has.skills ? chartCard('Skills', 'chSkills', 'self-rated 1–10') : maybeChart(C.goals.length > 0, 'Goal progress', 'chGoals', 'percent complete', 'Goals you add appear here as progress bars.', 'add-goal')}
        ${C.has.salary ? chartCard('Salary vs market', 'chSalary', 'market range is a demo benchmark') : ''}
        ${C.has.focus ? chartCard('Deep work vs meetings', 'chFocus', 'hours per week') : ''}
      </div>
      ${HB.list.length ? `<div class="card"><h2>Habits<small>last 14 days vs the 2 weeks before</small></h2><table class="tbl"><thead><tr><th>Habit</th><th class="num">Last 14d</th><th class="num">Before</th><th class="num">Streak</th></tr></thead><tbody>
        ${HB.list.map((h) => `<tr><td>${esc(h.name)}</td><td class="num">${ok(h.rate14) ? Math.round(h.rate14 * 100) + '%' : '–'}</td><td class="num">${ok(h.ratePrev) ? Math.round(h.ratePrev * 100) + '%' : '–'}</td><td class="num">${h.streak}d</td></tr>`).join('')}</tbody></table></div>`
        : emptyCard('Habits', 'Add habits to track streaks; tick them off in your daily check-in.', 'edit-habits')}`;
    if (C.has.skills) chart('chSkills', { type: 'radar', data: { labels: C.skills.map((s) => s.name), datasets: [{ label: 'Level', data: C.skills.map((s) => s.level), backgroundColor: alpha('#22c3a6', 0.2), borderColor: '#22c3a6', pointBackgroundColor: '#22c3a6', pointRadius: 3, tension: 0 }] },
      options: { plugins: { legend: { display: false } }, scales: { r: { min: 0, max: 10, ticks: { display: false, stepSize: 2 }, grid: { color: css('--border') }, angleLines: { color: css('--border') }, pointLabels: { color: css('--text'), font: { size: 11 } } } } } });
    chart('chGoals', { type: 'bar', data: { labels: C.goals.map((g) => (g.name.length > 26 ? g.name.slice(0, 25) + '…' : g.name)), datasets: [{ label: 'Progress', data: C.goals.map((g) => g.progress), backgroundColor: C.goals.map((g) => (ok(g.daysLeft) && g.daysLeft < 0 && g.progress < 100 ? '#ef5168' : '#7c5cff')) }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false }, ticks: { autoSkip: false } } } } });
    if (C.has.salary) chart('chSalary', { type: 'line', data: { labels: C.salaryHistory.map((s) => s.year), datasets: [
      { label: 'Salary', data: C.salaryHistory.map((s) => s.salary), borderColor: '#7c5cff', backgroundColor: alpha('#7c5cff', 0.12), fill: true, pointRadius: 3 },
      { label: 'Market mid (2025)', data: C.salaryHistory.map(() => C.marketRange.mid), borderColor: '#f0a020', borderDash: [5, 5], borderWidth: 1.5 },
      { label: 'Market range', data: C.salaryHistory.map(() => C.marketRange.low), borderColor: alpha('#f0a020', 0.25), borderWidth: 1, fill: '+1', backgroundColor: alpha('#f0a020', 0.08) },
      { label: '', data: C.salaryHistory.map(() => C.marketRange.high), borderColor: alpha('#f0a020', 0.25), borderWidth: 1 }] },
      options: { plugins: { legend: { position: 'bottom', labels: { filter: (i) => i.text } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label || 'Market high'}: ${fmt.usd(c.raw)}` } } }, scales: { y: { ticks: { callback: (v) => '$' + v / 1000 + 'k' } }, x: { grid: { display: false } } } } });
    if (C.has.focus) chart('chFocus', { type: 'bar', data: { labels: C.focusHoursByWeek.map((w) => fmt.date(w.week)), datasets: [
      { label: 'Deep work', data: C.focusHoursByWeek.map((w) => w.deep), backgroundColor: '#22c3a6', stack: 'a' },
      { label: 'Meetings', data: C.focusHoursByWeek.map((w) => w.meetings), backgroundColor: alpha('#ef5168', 0.75), stack: 'a' }] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0 } }, y: { stacked: true } } } });
  }

  // ---------- data & privacy tab (rendered by forms.js) ----------
  function renderData(el) { E.ui.renderDataTab(el, M, mode); }

  // ---------- tabs ----------
  const renderers = { overview: renderOverview, finance: renderFinance, health: renderHealth, relationships: renderRelationships, career: renderCareer, data: renderData };
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
  let chatHistory = [];
  const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  function addMsg(role, html) { const d = document.createElement('div'); d.className = 'msg ' + role; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  const SRC = { gemini: 'Gemini · your key', groq: 'Groq · your key', webllm: 'On-device model' };
  async function ask(q) {
    q = String(q).trim(); if (!q) return;
    $('#chips').classList.add('compact'); addMsg('user', esc(q)); chatHistory.push({ role: 'user', content: q }); input.value = '';
    const t = addMsg('twin', '<span class="typing" aria-label="Twin is thinking"><i></i><i></i><i></i></span>');
    const cfg = S.getAI();
    if (cfg.provider === 'local') await new Promise((r) => setTimeout(r, 450 + Math.random() * 300));
    try {
      const r = await E.twin.askTwin(q, M, chatHistory, { onProgress: (p) => { t.innerHTML = `<span class="muted">Loading on-device model… ${Math.round((p.progress || 0) * 100)}%</span>`; } });
      t.innerHTML = md(r.text) + (r.disclaimer ? `<span class="disc">${DISC[r.disclaimer]}</span>` : '') + (r.note ? `<span class="src">${esc(r.note)}</span>` : SRC[r.source] ? `<span class="src">${SRC[r.source]}</span>` : '');
      chatHistory.push({ role: 'assistant', content: r.text });
    } catch (err) { t.innerHTML = 'Sorry, something went wrong: ' + esc(err.message); }
    log.scrollTop = log.scrollHeight;
  }
  const CHIPS_DEMO = ['How much did I spend on food?', 'Am I sleeping enough?', 'Who should I call this week?', 'Can I afford a $1,200 trip?', 'How am I doing overall?', "What's my blood pressure?", 'Should I ask for a raise?', 'How are my goals going?'];
  const CHIPS_USER = ['How am I doing overall?', 'How much did I spend on food?', 'Am I sleeping enough?', 'Who should I call this week?', 'Can I afford a $300 purchase?', 'How is my mood?', 'How are my goals going?', 'Which debt should I pay first?'];
  function resetChat() {
    log.innerHTML = ''; chatHistory = [];
    $('#chips').classList.remove('compact');
    $('#chips').innerHTML = (M.isDemo ? CHIPS_DEMO : CHIPS_USER).map((c) => `<button type="button" class="chip">${esc(c)}</button>`).join('');
    if (M.isDemo) addMsg('twin', md(`Hi ${M.profile.firstName}, I'm your twin. I've read ${M.persona.finance.transactions.length} transactions, ${M.health.daily.length} days of health logs and your contact history. Today's Life Score is **${M.scores.life}**. Ask me anything, or tap a suggestion.`));
    else addMsg('twin', md(`Hi ${M.profile.firstName === 'You' ? 'there' : M.profile.firstName}, I'm your twin. I've read what you've logged on this device: ${M.finance.has.txCount} transactions, ${M.health.daily.length} check-ins, ${M.relationships.contacts.length} people and ${M.career.goals.length} goals.${ok(M.scores.life) ? ` Your Life Score is **${M.scores.life}**.` : ' Add a bit more and I can score your week.'} Ask me anything, or tap a suggestion.`));
    renderChatNote();
  }
  function renderChatNote() {
    const cfg = S.getAI();
    const label = { local: 'Built-in logic (no AI model, nothing sent anywhere)', gemini: 'AI: Gemini with your key', groq: 'AI: Groq with your key', webllm: 'AI: on-device model' }[cfg.provider] || 'Built-in logic';
    $('#chatNote').innerHTML = `${esc(label)} · <button type="button" class="link-btn" data-action="ai-settings">${cfg.provider === 'local' ? 'Connect a free AI' : 'AI settings'}</button>`;
  }
  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) ask(c.textContent); });
  $('#chatForm').addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });
  // mobile sheet
  const openChat = () => { document.body.classList.add('chat-open'); setTimeout(() => input.focus({ preventScroll: true }), 300); };
  const closeChat = () => document.body.classList.remove('chat-open');
  $('#chatFab').addEventListener('click', openChat);
  $('#chatClose').addEventListener('click', closeChat);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) closeChat(); });
  document.addEventListener('click', (e) => { if (document.body.classList.contains('chat-open') && !e.target.closest('.chat') && !e.target.closest('.fab') && !e.target.closest('dialog')) closeChat(); });

  // ---------- mode + boot ----------
  function compute() {
    if (mode === 'user') {
      const d = S.get();
      if (!d) { mode = 'demo'; return compute(); }
      M = E.buildModel(S.toInput(d));
    } else M = E.buildModel(window.PERSONA);
    INS = E.insights.overviewInsights(M);
  }
  function refresh(keepChat) {
    compute(); renderChrome(); renderHero(); show(current, false);
    if (!keepChat || !chatHistory.length) resetChat(); else renderChatNote(); // keep a conversation in progress; otherwise refresh the greeting numbers
  }
  function setMode(m, opts = {}) {
    mode = m === 'user' && S.get() ? 'user' : 'demo';
    S.setMode(mode);
    document.body.classList.remove('show-welcome');
    current = opts.tab || 'overview';
    refresh(false);
    if (!opts.noScroll) window.scrollTo({ top: 0 });
  }
  $('#modeDemo').addEventListener('click', () => setMode('demo'));
  $('#modeUser').addEventListener('click', () => { const d = S.get(); if (d && d.onboarded) setMode('user'); else E.ui.openWizard(0); });

  S.onChange((d, why) => {
    if (why === 'delete') { mode = 'demo'; document.body.classList.add('show-welcome'); E.ui.renderWelcome(); return; }
    if (mode === 'user') refresh(true);
  });

  window.EvenselfApp = { get model() { return M; }, show, ask, openChat, setMode, refresh, get mode() { return mode; }, get tab() { return current; } };

  chartDefaults();
  const saved = S.getMode(), hasUser = !!(S.get() && S.get().onboarded);
  const startTab = (location.hash || '#overview').slice(1);
  if (!saved || (saved === 'user' && !hasUser)) {
    // first visit: welcome screen (demo renders behind it so the page is never blank)
    mode = 'demo'; current = renderers[startTab] ? startTab : 'overview';
    compute(); renderChrome(); renderHero(); show(current, false); resetChat();
    document.body.classList.add('show-welcome'); E.ui.renderWelcome();
  } else {
    mode = saved === 'user' && hasUser ? 'user' : 'demo'; current = renderers[startTab] ? startTab : 'overview';
    compute(); renderChrome(); renderHero(); show(current, false); resetChat();
  }
})();
