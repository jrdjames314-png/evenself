/* Evenself: everything the visitor types in.
   Welcome screen, the "Create my twin" wizard (also reused as the Edit forms), quick-add sheet
   (transaction, daily check-in, log contact, goal progress, CSV import), the Data & privacy tab
   (entries, backup, delete, AI settings), toasts and confirm dialogs. All writes go through Evenself.store. */
(function () {
  'use strict';
  const E = window.Evenself, S = E.store, { fmt } = E, ok = E.util.ok;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = S.num;
  const app = () => window.EvenselfApp;

  // ---------- toast + confirm ----------
  let toastT;
  function toast(msg, kind = '') {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show ' + kind;
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 3200);
  }
  function confirmBox({ title, body, okLabel = 'OK', danger = false, typeToConfirm = null }) {
    return new Promise((resolve) => {
      const dlg = $('#confirmDlg');
      dlg.innerHTML = `<form method="dialog" class="dlg-inner small"><h2>${esc(title)}</h2><p>${body}</p>
        ${typeToConfirm ? `<label class="fld"><span>Type <b>${typeToConfirm}</b> to confirm</span><input name="conf" autocomplete="off" autocapitalize="characters" /></label>` : ''}
        <div class="dlg-actions"><button type="button" class="btn ghost" value="cancel" data-x="cancel">Cancel</button><button type="submit" class="btn ${danger ? 'danger' : ''}" value="ok" ${typeToConfirm ? 'disabled' : ''}>${esc(okLabel)}</button></div></form>`;
      const inp = $('input[name=conf]', dlg), okBtn = $('button[type=submit]', dlg);
      if (inp) inp.addEventListener('input', () => { okBtn.disabled = inp.value.trim().toUpperCase() !== typeToConfirm; });
      $('[data-x=cancel]', dlg).addEventListener('click', () => dlg.close('cancel'));
      dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
      dlg.returnValue = ''; dlg.showModal(); (inp || okBtn).focus();
    });
  }

  // ---------- small field builders ----------
  const opt = (v, cur, label) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label ?? v)}</option>`;
  const fld = (label, inner, hint, cls = '') => `<label class="fld ${cls}"><span>${label}</span>${inner}${hint ? `<small>${hint}</small>` : ''}</label>`;
  const inp = (name, val, attrs = '') => `<input name="${name}" value="${esc(val ?? '')}" ${attrs} />`;
  const money = (name, val, ph = '0') => `<div class="money"><span>$</span>${inp(name, val, `inputmode="decimal" placeholder="${ph}" autocomplete="off"`)}</div>`;
  const CATS = S.CATEGORIES;
  const catSelect = (name, cur, extra = []) => `<select name="${name}">${extra.concat(CATS).map((c) => opt(c, cur)).join('')}</select>`;
  const RELATIONS = ['Mom', 'Dad', 'Partner', 'Sister', 'Brother', 'Grandparent', 'Child', 'Friend', 'Best friend', 'Mentor', 'Coworker', 'Other'];
  const EVERY = [[1, 'Every day'], [3, 'Every few days'], [7, 'Weekly'], [14, 'Every 2 weeks'], [30, 'Monthly'], [60, 'Every 2 months'], [90, 'Every 3 months']];
  const AREAS = ['career', 'money', 'health', 'relationships', 'learning', 'personal'];

  /** repeatable rows: fields = [{k,label,type,opts,ph,cls}] */
  function rep(name, rows, fields, addLabel) {
    const row = (r = {}) => `<div class="rep-row" data-id="${esc(r.id || '')}">${fields.map((f) => cell(f, r[f.k])).join('')}<button type="button" class="icon-sm rm" aria-label="Remove row" data-rm>✕</button></div>`;
    return `<div class="rep" data-rep="${name}">${rows.map(row).join('')}<template>${row()}</template><button type="button" class="btn ghost sm add-row" data-add>+ ${addLabel}</button></div>`;
  }
  function cell(f, v) {
    const n = 'r_' + f.k;
    let c;
    if (f.type === 'select') c = `<select name="${n}">${f.opts.map((o) => (Array.isArray(o) ? opt(o[0], v ?? f.def, o[1]) : opt(o, v ?? f.def))).join('')}</select>`;
    else if (f.type === 'money') c = money(n, v, f.ph);
    else if (f.type === 'date') c = inp(n, v, 'type="date"');
    else if (f.type === 'md') c = inp(n, v ? '2000-' + v : '', 'type="date"');
    else if (f.type === 'number') c = inp(n, v, `inputmode="decimal" placeholder="${f.ph || ''}"`);
    else c = inp(n, v, `placeholder="${esc(f.ph || '')}" autocomplete="off"`);
    return `<label class="fld ${f.cls || ''}"><span>${f.label}</span>${c}</label>`;
  }
  function readRep(root, name, fields) {
    const box = $(`[data-rep="${name}"]`, root); if (!box) return null;
    return $$(':scope > .rep-row', box).map((row) => {
      const o = { id: row.dataset.id || S.uid() };
      fields.forEach((f) => { const el = $(`[name="r_${f.k}"]`, row); let v = el ? el.value.trim() : '';
        if (f.type === 'money' || f.type === 'number') v = num(v);
        if (f.type === 'md') v = v ? v.slice(5) : null;
        o[f.k] = v === '' ? null : v; });
      return o;
    }).filter((o) => o[fields[0].k] !== null && o[fields[0].k] !== '');
  }
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
    if (add) { const box = add.closest('.rep'); const tpl = $(':scope > template', box); add.insertAdjacentHTML('beforebegin', tpl.innerHTML); const rows = $$(':scope > .rep-row', box); const f = $('input,select', rows[rows.length - 1]); if (f) f.focus(); }
    if (rm) rm.closest('.rep-row').remove();
  });

  // ---------- field sets ----------
  const F_BILL = [{ k: 'name', label: 'Bill', ph: 'Rent' }, { k: 'amount', label: 'Per month', type: 'money' }, { k: 'category', label: 'Category', type: 'select', opts: CATS, def: 'Housing' }];
  const F_ACCT = [{ k: 'name', label: 'Account', ph: 'Checking' }, { k: 'type', label: 'Type', type: 'select', opts: [['checking', 'Checking'], ['savings', 'Savings'], ['emergency', 'Emergency fund'], ['investment', 'Investments'], ['retirement', 'Retirement']] }, { k: 'balance', label: 'Balance', type: 'money' }];
  const F_DEBT = [{ k: 'name', label: 'Debt', ph: 'Credit card' }, { k: 'kind', label: 'Type', type: 'select', opts: [['card', 'Credit card'], ['loan', 'Loan'], ['other', 'Other']] }, { k: 'balance', label: 'Balance', type: 'money' },
    { k: 'apr', label: 'APR %', type: 'number', ph: '24.9', cls: 'xs' }, { k: 'minPayment', label: 'Min / mo', type: 'money', cls: 'sm' }, { k: 'limit', label: 'Card limit', type: 'money', ph: 'optional', cls: 'sm' }];
  const F_PERSON = [{ k: 'name', label: 'Name', ph: 'Maria' }, { k: 'relation', label: 'Relation', type: 'select', opts: RELATIONS, def: 'Friend' }, { k: 'everyDays', label: 'Talk how often', type: 'select', opts: EVERY, def: 14 },
    { k: 'birthday', label: 'Birthday (any year)', type: 'md' }, { k: 'lastTalked', label: 'Last talked', type: 'date' }];
  const F_GOAL = [{ k: 'name', label: 'Goal', ph: 'Run a 10k' }, { k: 'area', label: 'Area', type: 'select', opts: AREAS, def: 'personal' }, { k: 'targetDate', label: 'Target date', type: 'date' }, { k: 'progress', label: 'Progress %', type: 'number', ph: '0', cls: 'xs' }];
  const F_HABIT = [{ k: 'name', label: 'Habit', ph: 'Walk 20 minutes' }];
  const BUDGET_CATS = ['Groceries', 'Dining', 'Shopping', 'Transport', 'Entertainment', 'Subscriptions', 'Travel', 'Personal care'];

  // ---------- wizard steps (also used as edit forms) ----------
  const STEPS = [
    { id: 'profile', title: 'About you', intro: 'Just enough for your twin to talk to you. All fields are optional.',
      render: (d) => `<div class="grid-f">${fld('Name', inp('name', d.profile.name, 'placeholder="Your first name" autocomplete="given-name"'))}${fld('Age', inp('age', d.profile.age, 'inputmode="numeric" placeholder="30"'), '', 'xs')}
        ${fld('City', inp('city', d.profile.city, 'placeholder="Denver, CO"'))}${fld('Occupation', inp('occupation', d.profile.occupation, 'placeholder="Nurse, student, designer…"'))}</div>
        ${fld('What do you want to improve?', `<textarea name="goalsText" rows="2" placeholder="Save for a trip, sleep more, call family more…">${esc(d.profile.goalsText)}</textarea>`)}`,
      read: (f, d) => { d.profile.name = f.name.value.trim(); d.profile.age = num(f.age.value); d.profile.city = f.city.value.trim(); d.profile.occupation = f.occupation.value.trim(); d.profile.goalsText = f.goalsText.value.trim(); } },
    { id: 'finance', title: 'Money', intro: 'Rough numbers are fine. Recurring bills are counted automatically every month, so you don\'t need to log them as transactions.',
      render: (d) => { const F = d.finance; const cs = F.creditScores.length ? F.creditScores[F.creditScores.length - 1].score : '';
        return `<div class="grid-f">${fld('Monthly take-home pay', money('monthlyIncome', F.monthlyIncome, '4,200'), 'After tax, all jobs combined')}${fld('Credit score', inp('credit', cs, 'inputmode="numeric" placeholder="optional"'), 'Optional; update monthly', 'sm')}</div>
        <h3>Recurring bills</h3>${rep('bills', F.bills, F_BILL, 'Add bill')}
        <label class="check"><input type="checkbox" name="autoBills" ${F.autoBills ? 'checked' : ''}/> Count these bills (and debt minimums) automatically each month</label>
        <h3>Cash, savings &amp; investments</h3>${rep('accounts', F.accounts, F_ACCT, 'Add account')}
        <h3>Debts</h3>${rep('debts', F.debts, F_DEBT, 'Add debt')}
        <details class="more"${Object.keys(F.budgets || {}).length ? ' open' : ''}><summary>Monthly budgets (optional)</summary><div class="grid-b">${BUDGET_CATS.map((c) => fld(c, money('b_' + c, (F.budgets || {})[c], '–'), '', 'sm')).join('')}</div></details>`; },
      read: (f, d) => { const F = d.finance; F.monthlyIncome = num(f.monthlyIncome.value);
        F.autoBills = f.autoBills.checked;
        F.bills = readRep(f, 'bills', F_BILL); F.accounts = readRep(f, 'accounts', F_ACCT); F.debts = readRep(f, 'debts', F_DEBT);
        F.budgets = {}; BUDGET_CATS.forEach((c) => { const v = num(f['b_' + c].value); if (v) F.budgets[c] = v; });
        const cs = num(f.credit.value), m = S.todayISO().slice(0, 7);
        if (cs && cs >= 300 && cs <= 850) { const i = F.creditScores.findIndex((x) => x.month === m); if (i >= 0) F.creditScores[i].score = cs; else F.creditScores.push({ month: m, score: cs }); } } },
    { id: 'health', title: 'Health', intro: 'Targets your twin compares your daily check-ins against. Blood pressure is optional.',
      render: (d, wiz) => { const H = d.health; const kg = H.weightUnit === 'kg';
        return `<div class="grid-f">${fld('Sleep target (hours)', inp('sleepTarget', H.sleepTarget, 'inputmode="decimal"'), '', 'sm')}${fld('Daily steps goal', inp('stepsGoal', H.stepsGoal, 'inputmode="numeric"'), '', 'sm')}
          ${fld('Weight unit', `<select name="weightUnit">${opt('lb', H.weightUnit, 'lb')}${opt('kg', H.weightUnit, 'kg')}</select>`, '', 'xs')}
          ${wiz ? fld('Current weight', inp('weightNow', '', 'inputmode="decimal" placeholder="optional"'), 'Saved as today\'s check-in', 'sm') : ''}
          ${fld('Goal weight', inp('weightGoal', H.weightGoal, 'inputmode="decimal" placeholder="optional"'), '', 'sm')}
          ${fld(`Height (${kg ? 'cm' : 'inches'})`, inp('height', H.heightIn ? (kg ? Math.round(H.heightIn * 2.54) : H.heightIn) : '', 'inputmode="decimal" placeholder="optional, for BMI"'), '', 'sm')}</div>
          <label class="check"><input type="checkbox" name="trackBP" ${H.trackBP ? 'checked' : ''}/> I check my blood pressure at home (adds BP fields to the daily check-in)</label>`; },
      read: (f, d) => { const H = d.health; H.sleepTarget = num(f.sleepTarget.value) || 7.5; H.stepsGoal = num(f.stepsGoal.value) || 8000; H.weightUnit = f.weightUnit.value;
        H.weightGoal = num(f.weightGoal.value); const h = num(f.height.value); H.heightIn = h ? (H.weightUnit === 'kg' ? Math.round(h / 2.54 * 10) / 10 : h) : null; H.trackBP = f.trackBP.checked;
        if (f.weightNow && num(f.weightNow.value)) upsertCheckin(d, S.todayISO(), { weight: num(f.weightNow.value) }); } },
    { id: 'people', title: 'People', intro: 'The people you want to stay close to, and how often you\'d like to talk. Your twin tells you who you\'re drifting from.',
      render: (d) => rep('people', d.people.map((p) => ({ ...p, lastTalked: (p.log || []).map((l) => l.date).sort().pop() || '' })), F_PERSON, 'Add person'),
      read: (f, d) => { const rows = readRep(f, 'people', F_PERSON); const old = Object.fromEntries(d.people.map((p) => [p.id, p]));
        d.people = rows.map((r) => { const p = old[r.id] || { id: r.id, added: S.todayISO(), log: [] };
          Object.assign(p, { name: r.name, relation: r.relation, everyDays: num(r.everyDays) || 14, birthday: r.birthday || null });
          if (r.lastTalked && !p.log.some((l) => l.date === r.lastTalked)) p.log.push({ id: S.uid(), date: r.lastTalked, type: 'chat' });
          return p; }); } },
    { id: 'goals', title: 'Goals', intro: 'Career, money, health or personal. A target date lets your twin check your pace.',
      render: (d) => rep('goals', d.goals, F_GOAL, 'Add goal'),
      read: (f, d) => { const rows = readRep(f, 'goals', F_GOAL); const old = Object.fromEntries(d.goals.map((g) => [g.id, g]));
        d.goals = rows.map((r) => { const g = old[r.id] || { id: r.id, created: S.todayISO(), history: [] }; const p = Math.max(0, Math.min(100, num(r.progress) || 0));
          if (g.progress !== p) (g.history = g.history || []).push({ date: S.todayISO(), progress: p });
          return Object.assign(g, { name: r.name, area: r.area, targetDate: r.targetDate || null, progress: p }); }); } },
    { id: 'habits', title: 'Habits', intro: 'Small daily things you want to keep doing. You tick them off in the daily check-in.',
      render: (d) => `${rep('habits', d.habits, F_HABIT, 'Add habit')}<div class="sugg"><small class="muted">Ideas:</small> ${['Walk 20 minutes', 'No phone after 10pm', 'Read 15 minutes', 'Drink 8 glasses of water', 'Stretch', 'No takeout'].map((x) => `<button type="button" class="chip" data-sugg="${esc(x)}">${esc(x)}</button>`).join('')}</div>`,
      read: (f, d) => { const rows = readRep(f, 'habits', F_HABIT); const old = Object.fromEntries(d.habits.map((h) => [h.id, h]));
        d.habits = rows.map((r) => Object.assign(old[r.id] || { id: r.id, created: S.todayISO(), done: [] }, { name: r.name })); } },
  ];
  document.addEventListener('click', (e) => {
    const s = e.target.closest('[data-sugg]'); if (!s) return;
    const box = $('[data-rep="habits"]'); if (!box) return;
    $(':scope > [data-add]', box).click(); const rows = $$(':scope > .rep-row', box); $('input', rows[rows.length - 1]).value = s.dataset.sugg; s.remove();
  });

  function upsertCheckin(d, date, vals) {
    let c = d.health.checkins.find((x) => x.date === date);
    if (!c) { c = { id: S.uid(), date }; d.health.checkins.push(c); }
    Object.assign(c, vals); return c;
  }

  // ---------- wizard dialog ----------
  let wiz = null; // { step, draft, edit }
  function openWizard(step = 0) {
    const cur = S.get();
    wiz = { step, draft: cur ? JSON.parse(JSON.stringify(cur)) : S.blank(), edit: false };
    renderWizard(); const dlg = $('#wizard'); if (!dlg.open) dlg.showModal();
  }
  function openEdit(step, opts = {}) {
    if (!S.get()) return openWizard(0);
    wiz = { step, draft: JSON.parse(JSON.stringify(S.get())), edit: true };
    renderWizard();
    const dlg = $('#wizard'); if (!dlg.open) dlg.showModal();
    if (opts.addRow) { const b = $(`[data-rep] > [data-add]`, dlg); if (b) b.click(); }
  }
  function renderWizard() {
    const dlg = $('#wizard'), st = STEPS[wiz.step], n = STEPS.length;
    const done = wiz.step >= n;
    const pct = Math.round((Math.min(wiz.step, n) / n) * 100);
    dlg.innerHTML = `<form class="dlg-inner" novalidate>
      <div class="dlg-head"><div>${wiz.edit ? '<small class="muted">Edit</small>' : `<small class="muted">Create my twin · ${done ? 'done' : `step ${wiz.step + 1} of ${n}`}</small>`}<h2>${done ? 'Your twin is ready' : st.title}</h2></div>
        <button type="button" class="icon-btn" data-x="close" aria-label="Close">✕</button></div>
      ${wiz.edit ? '' : `<div class="progress" aria-hidden="true"><i style="width:${pct}%"></i></div>`}
      <div class="dlg-body">${done ? doneHtml() : `<p class="muted intro">${st.intro}</p>${st.render(wiz.draft, !wiz.edit)}${wiz.step === 0 && !wiz.edit ? privacyMini() : ''}`}</div>
      <div class="dlg-actions">${done ? `<button type="button" class="btn" data-x="finish">Open my dashboard</button>`
        : wiz.edit ? `<button type="button" class="btn ghost" data-x="close">Cancel</button><button type="submit" class="btn">Save</button>`
        : `${wiz.step > 0 ? '<button type="button" class="btn ghost" data-x="back">Back</button>' : '<span></span>'}<span class="spacer"></span><button type="button" class="btn ghost" data-x="skip">Skip</button><button type="submit" class="btn">${wiz.step === n - 1 ? 'Finish' : 'Next'}</button>`}</div></form>`;
    const f = $('form', dlg);
    f.addEventListener('submit', (e) => { e.preventDefault(); STEPS[wiz.step].read(f, wiz.draft);
      if (wiz.edit) { wiz.draft.onboarded = true; S.save(wiz.draft, 'edit'); dlg.close(); toast('Saved'); return; }
      persistDraft(); wiz.step++; renderWizard(); });
    f.addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'close') dlg.close();
      if (x.dataset.x === 'back') { wiz.step--; renderWizard(); }
      if (x.dataset.x === 'skip') { wiz.step++; renderWizard(); }
      if (x.dataset.x === 'finish') { wiz.draft.onboarded = true; S.save(wiz.draft, 'onboard'); dlg.close(); app().setMode('user'); toast('Welcome to your twin. Your data is saved on this device only.'); }
      if (x.dataset.go) { wiz.draft.onboarded = true; S.save(wiz.draft, 'onboard'); dlg.close(); app().setMode('user'); act(x.dataset.go); } });
    const first = $('.dlg-body input, .dlg-body select, .dlg-body textarea', dlg); if (first && window.innerWidth > 700) setTimeout(() => first.focus(), 30);
    $('.dlg-body', dlg).scrollTop = 0;
  }
  function persistDraft() { S.save(wiz.draft, 'wizard'); }
  function doneHtml() {
    const d = wiz.draft;
    const items = [[d.profile.name || 'Profile', !!d.profile.name], [`${d.finance.bills.length} bills, ${d.finance.accounts.length} accounts, ${d.finance.debts.length} debts`, d.finance.monthlyIncome || d.finance.accounts.length],
      [`${d.people.length} people`, d.people.length], [`${d.goals.length} goals`, d.goals.length], [`${d.habits.length} habits`, d.habits.length]];
    return `<p>Saved on this device only. Your dashboard fills in as you add day-to-day entries:</p>
      <ul class="done-list">${items.map(([t, v]) => `<li class="${v ? 'y' : ''}">${esc(t)}</li>`).join('')}</ul>
      <div class="next-grid">
        <button type="button" class="next" data-x="go" data-go="checkin"><b>Do today's check-in</b><span>Sleep, steps, mood, energy, weight</span></button>
        <button type="button" class="next" data-x="go" data-go="add-tx"><b>Add a transaction</b><span>Or a few, to unlock spending</span></button>
        <button type="button" class="next" data-x="go" data-go="import-csv"><b>Import a bank CSV</b><span>Auto-categorized by keywords</span></button>
      </div>`;
  }
  const privacyMini = () => `<div class="privacy-mini"><b>🔒 Private by design.</b> Everything you enter is saved only in this browser on this device. No account, no server, no analytics. You can export or delete it any time.</div>`;

  // ---------- quick-add sheet ----------
  const SHEET_TABS = [['tx', 'Transaction'], ['checkin', 'Check-in'], ['contact', 'Log contact'], ['goal', 'Goal progress'], ['csv', 'Import CSV']];
  let sheet = { tab: 'tx', opts: {} };
  function openSheet(tab = 'tx', opts = {}) {
    if (!S.get() || !S.get().onboarded) return openWizard(0);
    sheet = { tab, opts };
    renderSheet(); const dlg = $('#sheet'); if (!dlg.open) dlg.showModal();
  }
  function renderSheet() {
    const dlg = $('#sheet');
    dlg.innerHTML = `<div class="dlg-inner"><div class="dlg-head"><h2>${sheet.opts.id || sheet.opts.date ? 'Edit' : 'Add'}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
      <div class="seg" role="tablist">${SHEET_TABS.map(([k, l]) => `<button type="button" role="tab" data-st="${k}" aria-selected="${k === sheet.tab}">${l}</button>`).join('')}</div>
      <div class="dlg-body" id="sheetBody"></div></div>`;
    $('[data-close]', dlg).addEventListener('click', () => dlg.close());
    $('.seg', dlg).addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (b) { sheet = { tab: b.dataset.st, opts: {} }; renderSheet(); } });
    ({ tx: txForm, checkin: checkinForm, contact: contactForm, goal: goalForm, csv: csvForm })[sheet.tab]($('#sheetBody', dlg));
  }
  const saveRow = (html) => `<div class="dlg-actions">${html}</div>`;

  function txForm(el) {
    const d = S.get(), t = sheet.opts.id ? d.finance.transactions.find((x) => x.id === sheet.opts.id) : null;
    const kind = t && t.category === 'Income' ? 'income' : 'expense';
    el.innerHTML = `<form novalidate>
      <div class="seg small" role="radiogroup" aria-label="Type"><label><input type="radio" name="kind" value="expense" ${kind === 'expense' ? 'checked' : ''}/>Expense</label><label><input type="radio" name="kind" value="income" ${kind === 'income' ? 'checked' : ''}/>Income</label></div>
      <div class="grid-f">${fld('Amount', money('amount', t ? t.amount : '', '0.00'), '', 'sm')}${fld('Date', inp('date', t ? t.date : S.todayISO(), 'type="date"'), '', 'sm')}</div>
      ${fld('Note', inp('note', t ? t.note : '', 'placeholder="Trader Joe\'s, Uber, rent…" autocomplete="off"'), 'The category is guessed from the note; change it if needed')}
      ${fld('Category', catSelect('category', t ? t.category : 'Other', ['Income', 'Savings transfers', 'Debt payments']))}
      ${saveRow(`${t ? '<button type="button" class="btn ghost danger-text" data-del>Delete</button>' : ''}<span class="spacer"></span><button type="submit" class="btn">${t ? 'Save' : 'Add transaction'}</button>`)}</form>`;
    const f = $('form', el); let touched = !!t;
    f.category.addEventListener('change', () => (touched = true));
    f.note.addEventListener('input', () => { if (!touched) { const c = S.categorize(f.note.value, f.kind.value === 'income' ? 'Income' : 'Other'); f.category.value = f.kind.value === 'income' ? 'Income' : c === 'Income' ? 'Other' : c; } });
    f.addEventListener('change', (e) => { if (e.target.name === 'kind' && !touched) f.category.value = f.kind.value === 'income' ? 'Income' : S.categorize(f.note.value, 'Other').replace('Income', 'Other'); });
    f.addEventListener('submit', (e) => { e.preventDefault();
      const amount = Math.abs(num(f.amount.value) || 0); if (!amount) { f.amount.focus(); toast('Enter an amount', 'warn'); return; }
      const cat = f.kind.value === 'income' ? 'Income' : f.category.value === 'Income' ? 'Other' : f.category.value;
      S.update((dd) => { const row = { id: t ? t.id : S.uid(), date: f.date.value || S.todayISO(), amount: Math.round(amount * 100) / 100, category: cat, note: f.note.value.trim() };
        const i = dd.finance.transactions.findIndex((x) => x.id === row.id); if (i >= 0) dd.finance.transactions[i] = { ...dd.finance.transactions[i], ...row }; else dd.finance.transactions.push(row); }, 'tx');
      toast(t ? 'Transaction saved' : `Added ${fmt.usd(amount, 2)} · ${cat}`);
      if (t) $('#sheet').close(); else { f.amount.value = ''; f.note.value = ''; touched = false; f.amount.focus(); } });
    const del = $('[data-del]', f); if (del) del.addEventListener('click', async () => { if (await confirmBox({ title: 'Delete this transaction?', body: esc(`${fmt.usd(t.amount, 2)} · ${t.category} · ${t.date}`), okLabel: 'Delete', danger: true })) { S.update((dd) => { dd.finance.transactions = dd.finance.transactions.filter((x) => x.id !== t.id); }, 'tx-del'); $('#sheet').close(); toast('Deleted'); } });
    if (window.innerWidth > 700) f.amount.focus();
  }

  const MOODS = [[1, '😞', 'Awful'], [2, '🙁', 'Low'], [3, '😐', 'Okay'], [4, '🙂', 'Good'], [5, '😄', 'Great']];
  function checkinForm(el) {
    const d = S.get(), date = sheet.opts.date || S.todayISO();
    const c = d.health.checkins.find((x) => x.date === date) || {};
    const showBP = d.health.trackBP || c.sys;
    const pills = (name, cur, list) => `<div class="pills" role="radiogroup">${list.map(([v, e, l]) => `<label title="${l}"><input type="radio" name="${name}" value="${v}" ${+cur === v ? 'checked' : ''}/><span>${e}<small>${l}</small></span></label>`).join('')}</div>`;
    el.innerHTML = `<form novalidate>
      ${fld('Date', inp('date', date, 'type="date"'), '', 'sm')}
      <div class="grid-f">${fld('Sleep (hours)', inp('sleep', c.sleep, 'inputmode="decimal" placeholder="7.5"'), '', 'sm')}${fld('Steps', inp('steps', c.steps, 'inputmode="numeric" placeholder="8000"'), '', 'sm')}
        ${fld(`Weight (${d.health.weightUnit})`, inp('weight', c.weight, 'inputmode="decimal" placeholder="optional"'), '', 'sm')}</div>
      <div class="fld"><span>Mood</span>${pills('mood', c.mood, MOODS)}</div>
      <div class="fld"><span>Energy</span>${pills('energy', c.energy, [[1, '1', 'Drained'], [2, '2', 'Low'], [3, '3', 'Okay'], [4, '4', 'Good'], [5, '5', 'Charged']])}</div>
      <details class="more" ${showBP ? 'open' : ''}><summary>Blood pressure (optional)</summary><div class="grid-f">${fld('Systolic', inp('sys', c.sys, 'inputmode="numeric" placeholder="120"'), '', 'xs')}${fld('Diastolic', inp('dia', c.dia, 'inputmode="numeric" placeholder="80"'), '', 'xs')}</div></details>
      ${d.habits.length ? `<div class="fld"><span>Habits done</span><div class="habit-checks">${d.habits.map((h) => `<label class="check"><input type="checkbox" name="h_${h.id}" ${(h.done || []).includes(date) ? 'checked' : ''}/> ${esc(h.name)}</label>`).join('')}</div></div>` : `<p class="muted small">Tip: add habits in Edit → Habits to tick them off here.</p>`}
      ${saveRow(`${c.id ? '<button type="button" class="btn ghost danger-text" data-del>Delete</button>' : ''}<span class="spacer"></span><button type="submit" class="btn">${c.id ? 'Save check-in' : 'Save check-in'}</button>`)}</form>`;
    const f = $('form', el);
    f.date.addEventListener('change', () => { sheet.opts.date = f.date.value; checkinForm(el); });
    f.addEventListener('submit', (e) => { e.preventDefault();
      const dt = f.date.value || S.todayISO();
      const v = { sleep: num(f.sleep.value), steps: num(f.steps.value), weight: num(f.weight.value), mood: num((f.mood && f.mood.value) || ''), energy: num((f.energy && f.energy.value) || ''), sys: num(f.sys.value), dia: num(f.dia.value) };
      if (v.sleep !== null && (v.sleep < 0 || v.sleep > 24)) { toast('Sleep should be 0–24 hours', 'warn'); return; }
      if ((v.sys && !v.dia) || (!v.sys && v.dia)) { toast('Enter both blood-pressure numbers', 'warn'); return; }
      S.update((dd) => { upsertCheckin(dd, dt, v);
        dd.habits.forEach((h) => { const box = f['h_' + h.id]; if (!box) return; h.done = (h.done || []).filter((x) => x !== dt); if (box.checked) h.done.push(dt); }); }, 'checkin');
      $('#sheet').close(); toast(`Check-in saved for ${fmt.date(dt)}`); });
    const del = $('[data-del]', f); if (del) del.addEventListener('click', async () => { if (await confirmBox({ title: 'Delete this check-in?', body: esc(fmt.date(date)), okLabel: 'Delete', danger: true })) { S.update((dd) => { dd.health.checkins = dd.health.checkins.filter((x) => x.date !== date); }, 'checkin-del'); $('#sheet').close(); toast('Deleted'); } });
  }

  function contactForm(el) {
    const d = S.get();
    if (!d.people.length) { el.innerHTML = `<p class="muted">Add someone first.</p><button type="button" class="btn" data-action="add-person">Add a person</button>`; return; }
    el.innerHTML = `<form novalidate>
      ${fld('Who', `<select name="pid">${d.people.map((p) => opt(p.id, sheet.opts.id || d.people[0].id, p.name + (p.relation ? ' · ' + p.relation : ''))).join('')}</select>`)}
      <div class="grid-f">${fld('How', `<select name="type">${['call', 'text', 'in person', 'video call', 'email'].map((x) => opt(x, 'call')).join('')}</select>`, '', 'sm')}${fld('When', inp('date', S.todayISO(), 'type="date"'), '', 'sm')}</div>
      ${fld('Note', inp('note', '', 'placeholder="optional" autocomplete="off"'))}
      ${saveRow(`<button type="button" class="btn ghost" data-action="add-person">Add person</button><span class="spacer"></span><button type="submit" class="btn">Log contact</button>`)}</form>`;
    const f = $('form', el);
    f.addEventListener('submit', (e) => { e.preventDefault();
      S.update((dd) => { const p = dd.people.find((x) => x.id === f.pid.value); (p.log = p.log || []).push({ id: S.uid(), date: f.date.value || S.todayISO(), type: f.type.value, note: f.note.value.trim() }); }, 'contact');
      const p = d.people.find((x) => x.id === f.pid.value); $('#sheet').close(); toast(`Logged ${f.type.value} with ${p.name.split(' ')[0]}`); });
  }

  function goalForm(el) {
    const d = S.get();
    if (!d.goals.length) { el.innerHTML = `<p class="muted">No goals yet.</p><button type="button" class="btn" data-action="add-goal">Add a goal</button>`; return; }
    const g0 = d.goals.find((g) => g.id === sheet.opts.id) || d.goals[0];
    el.innerHTML = `<form novalidate>
      ${fld('Goal', `<select name="gid">${d.goals.map((g) => opt(g.id, g0.id, g.name)).join('')}</select>`)}
      <div class="fld"><span>Progress</span><div class="range"><input type="range" name="pr" min="0" max="100" step="5" value="${g0.progress || 0}"/><output>${g0.progress || 0}%</output></div></div>
      ${fld('Target date', inp('due', g0.targetDate, 'type="date"'), '', 'sm')}
      ${saveRow(`<button type="button" class="btn ghost" data-action="add-goal">Edit goals</button><span class="spacer"></span><button type="submit" class="btn">Save progress</button>`)}</form>`;
    const f = $('form', el), out = $('output', f);
    f.pr.addEventListener('input', () => (out.textContent = f.pr.value + '%'));
    f.gid.addEventListener('change', () => { sheet.opts.id = f.gid.value; goalForm(el); });
    f.addEventListener('submit', (e) => { e.preventDefault();
      S.update((dd) => { const g = dd.goals.find((x) => x.id === f.gid.value); g.progress = +f.pr.value; g.targetDate = f.due.value || g.targetDate; (g.history = g.history || []).push({ date: S.todayISO(), progress: g.progress }); }, 'goal');
      $('#sheet').close(); toast(+f.pr.value >= 100 ? 'Goal complete. Nice work!' : 'Progress saved'); });
  }

  function csvForm(el) {
    el.innerHTML = `<div class="csv">
      <p class="muted">Export transactions from your bank as CSV, then pick the file. It's read right here in your browser; nothing is uploaded.</p>
      <label class="file-drop"><input type="file" accept=".csv,text/csv,text/plain" id="csvFile"/><span>Choose CSV file</span></label>
      <div id="csvMap"></div></div>`;
    $('#csvFile', el).addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return;
      if (file.size > 5e6) { toast('That file is over 5 MB', 'warn'); return; }
      const rows = S.parseCSV(await file.text()); if (rows.length < 2) { toast('No rows found in that file', 'warn'); return; }
      csvMapping($('#csvMap', el), rows, file.name); });
  }
  function csvMapping(box, rows, name) {
    const headers = rows[0], body = rows.slice(1), g = S.guessMapping(headers);
    const sel = (k, cur, optional) => `<select name="${k}">${optional ? opt(-1, cur, '— none —') : ''}${headers.map((h, i) => opt(i, cur, h || `Column ${i + 1}`)).join('')}</select>`;
    const negCount = body.filter((r) => num(r[g.amount]) < 0).length;
    box.innerHTML = `<form novalidate><h3>${esc(name)} · ${body.length} rows</h3>
      <div class="grid-f">${fld('Date column', sel('date', Math.max(0, g.date)), '', 'sm')}${fld('Description column', sel('description', g.description, true), '', 'sm')}
        ${fld('Amount column', sel('amount', g.amount, true), '', 'sm')}${fld('Category column', sel('category', g.category, true), 'Optional; otherwise auto-categorized', 'sm')}</div>
      <details class="more"${g.amount < 0 && (g.debit >= 0 || g.credit >= 0) ? ' open' : ''}><summary>Separate debit / credit columns?</summary><div class="grid-f">${fld('Debit (money out)', sel('debit', g.debit, true), '', 'sm')}${fld('Credit (money in)', sel('credit', g.credit, true), '', 'sm')}</div></details>
      <div class="fld"><span>In this file, spending is…</span><div class="seg small"><label><input type="radio" name="sign" value="neg-expense" ${negCount ? 'checked' : ''}/>Negative (−42.10)</label><label><input type="radio" name="sign" value="pos-expense" ${negCount ? '' : 'checked'}/>Positive (42.10)</label></div></div>
      <label class="check"><input type="checkbox" name="hasBills"/> This file already includes my rent and bills (stop auto-adding recurring bills)</label>
      <div id="csvPrev" class="tbl-wrap"></div>
      ${saveRow(`<span class="spacer"></span><button type="submit" class="btn">Import</button>`)}</form>`;
    const f = $('form', box);
    const mapping = () => ({ date: +f.date.value, description: +f.description.value, amount: +f.amount.value, category: +f.category.value, debit: +f.debit.value, credit: +f.credit.value });
    const preview = () => { const r = S.rowsToTransactions(body, mapping(), f.sign.value);
      $('#csvPrev', box).innerHTML = `<p class="muted small">${r.transactions.length} transactions ready${r.skipped.length ? `, ${r.skipped.length} rows can't be read (rows ${r.skipped.slice(0, 5).join(', ')}${r.skipped.length > 5 ? '…' : ''})` : ''}. Preview:</p>
        <table class="tbl"><thead><tr><th>Date</th><th>Note</th><th>Category</th><th class="num">Amount</th></tr></thead><tbody>${r.transactions.slice(0, 6).map((t) => `<tr><td>${t.date}</td><td class="trunc">${esc(t.note)}</td><td>${esc(t.category)}</td><td class="num ${t.category === 'Income' ? 'pos' : ''}">${t.category === 'Income' ? '+' : ''}${fmt.usd(t.amount, 2)}</td></tr>`).join('')}</tbody></table>`; return r; };
    f.addEventListener('change', preview); preview();
    f.addEventListener('submit', (e) => { e.preventDefault(); const r = preview(); let added = 0, dup = 0;
      S.update((dd) => { const seen = new Set(dd.finance.transactions.map((t) => `${t.date}|${t.amount}|${(t.note || '').toLowerCase()}`));
        r.transactions.forEach((t) => { const k = `${t.date}|${t.amount}|${t.note.toLowerCase()}`; if (seen.has(k)) { dup++; return; } seen.add(k); dd.finance.transactions.push(t); added++; });
        if (f.hasBills.checked) dd.finance.autoBills = false; }, 'csv');
      $('#sheet').close(); toast(`Imported ${added} transaction${added === 1 ? '' : 's'}${dup ? `, skipped ${dup} duplicate${dup === 1 ? '' : 's'}` : ''}${r.skipped.length ? `, ${r.skipped.length} unreadable` : ''}`); });
  }

  // ---------- backup ----------
  function exportJSON() {
    const blob = new Blob([JSON.stringify(S.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `evenself-backup-${S.todayISO()}.json`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast('Backup downloaded. Keep it somewhere private.');
  }
  async function importJSONFile(file) {
    try {
      const obj = JSON.parse(await file.text());
      if (S.get() && S.get().onboarded && !(await confirmBox({ title: 'Replace your data?', body: 'Importing replaces everything currently stored in this browser with the backup file.', okLabel: 'Replace', danger: true }))) return;
      S.importData(obj); app().setMode('user'); toast('Backup restored');
    } catch (err) { toast(err.message || 'Could not read that file', 'warn'); }
  }
  async function deleteAll() {
    if (!(await confirmBox({ title: 'Delete all your data?', body: 'This permanently erases everything Evenself stored in this browser: profile, entries, settings and any saved AI key. Download a backup first if you might want it back.', okLabel: 'Delete everything', danger: true, typeToConfirm: 'DELETE' }))) return;
    S.deleteAll(); toast('All your data was deleted from this browser.');
  }

  // ---------- data & privacy tab ----------
  function renderDataTab(el, M, mode) {
    const d = S.get();
    const user = mode === 'user' && d;
    el.innerHTML = `
      ${user ? entriesCard(d) : `<div class="card cta"><h2>Make it yours</h2><p>You're looking at Jordan, a fictional demo. Create your own twin in about 3 minutes; it stays on this device.</p><div class="row-actions"><button type="button" class="btn" data-action="create">Create my twin</button><label class="btn ghost file-btn">Restore a backup<input type="file" accept=".json,application/json" data-import-json hidden/></label></div></div>`}
      ${user ? `<div class="card"><h2>Backup &amp; delete</h2><p class="muted">Your data lives only in this browser. It doesn't sync between devices or browsers, and clearing site data erases it, so download a backup now and then.</p>
        <div class="row-actions"><button type="button" class="btn" data-export>Download my data (JSON)</button><label class="btn ghost file-btn">Import backup<input type="file" accept=".json,application/json" data-import-json hidden/></label><button type="button" class="btn ghost" data-action="edit-profile">Edit profile</button><button type="button" class="btn danger" data-delete-all>Delete all my data</button></div></div>` : ''}
      ${aiCard()}
      ${privacyCard()}`;
    $$('[data-import-json]', el).forEach((i) => i.addEventListener('change', (e) => { if (e.target.files[0]) importJSONFile(e.target.files[0]); e.target.value = ''; }));
    const ex = $('[data-export]', el); if (ex) ex.addEventListener('click', exportJSON);
    const da = $('[data-delete-all]', el); if (da) da.addEventListener('click', deleteAll);
    wireEntries(el); wireAI(el);
  }
  function privacyCard() {
    return `<div class="card" id="privacy"><h2>Privacy</h2><ul class="plist">
      <li><b>Stored only on this device.</b> Everything you enter is saved in this browser's local storage. There's no server, no account and no database.</li>
      <li><b>Never sent anywhere.</b> Dashboards, insights, the Life Score and the built-in twin all run in your browser. The page loads no analytics, ads, trackers, fonts or third-party scripts, and its Content-Security-Policy blocks connections to any server except the optional AI providers below.</li>
      <li><b>Optional AI chat is opt-in.</b> If you connect your own Gemini or Groq key, only your question, a summary of your computed stats and the built-in answer are sent to that provider (plus recent raw entries only if you tick that box). The on-device model downloads once and then runs locally.</li>
      <li><b>Your control.</b> Export everything as JSON, import it on another device, or delete it all in one click.</li>
      <li><b>Limits.</b> Data doesn't sync between devices. Anyone using this browser profile can open it, so don't use a shared computer. Not medical, financial or legal advice.</li></ul></div>`;
  }

  function entriesCard(d) {
    const tx = d.finance.transactions.slice().sort((a, b) => b.date.localeCompare(a.date));
    const ci = d.health.checkins.slice().sort((a, b) => b.date.localeCompare(a.date));
    const logs = d.people.flatMap((p) => (p.log || []).map((l) => ({ ...l, pid: p.id, who: p.name }))).sort((a, b) => b.date.localeCompare(a.date));
    const v = (x, s = '') => (ok(x) ? x + s : '–');
    return `<div class="card"><h2>Your entries<small>${tx.length} transactions · ${ci.length} check-ins · ${d.people.length} people · ${d.goals.length} goals</small></h2>
      <div class="seg small" role="tablist" id="entTabs">${[['tx', 'Transactions'], ['ci', 'Check-ins'], ['pp', 'People'], ['gl', 'Goals & habits']].map(([k, l], i) => `<button type="button" role="tab" data-et="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}</div>
      <div data-ep="tx"><div class="row-actions"><input type="search" placeholder="Search notes or categories" id="txSearch" aria-label="Search transactions"/><button type="button" class="btn sm" data-action="add-tx">+ Add</button><button type="button" class="btn ghost sm" data-action="import-csv">Import CSV</button></div>
        ${tx.length ? `<div class="tbl-wrap"><table class="tbl" id="txTable"><thead><tr><th>Date</th><th>Note</th><th class="hide-sm">Category</th><th class="num">Amount</th><th></th></tr></thead><tbody>${tx.map((t) => `<tr data-q="${esc((t.note + ' ' + t.category).toLowerCase())}"><td class="nowrap" title="${t.date}">${fmt.date(t.date)}${t.date.slice(0, 4) !== S.todayISO().slice(0, 4) ? ' ' + t.date.slice(0, 4) : ''}</td><td class="trunc">${esc(t.note || '')}<span class="sub-sm">${esc(t.category)}</span></td><td class="hide-sm">${esc(t.category)}</td><td class="num ${t.category === 'Income' ? 'pos' : ''}">${t.category === 'Income' ? '+' : ''}${fmt.usd(t.amount, 2)}</td><td class="num nowrap"><button type="button" class="icon-sm" data-action="edit-tx" data-id="${t.id}" aria-label="Edit">✎</button><button type="button" class="icon-sm" data-del-tx="${t.id}" aria-label="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No transactions yet.</p>'}
        ${d.finance.bills.length ? `<p class="muted small">Plus ${d.finance.bills.length} recurring bill${d.finance.bills.length > 1 ? 's' : ''} (${fmt.usd(d.finance.bills.reduce((s, b) => s + (b.amount || 0), 0))}/mo) ${d.finance.autoBills ? 'counted automatically each month' : 'not auto-counted (your CSV includes them)'} · <button type="button" class="link-btn" data-action="edit-finance">edit</button></p>` : ''}</div>
      <div data-ep="ci" hidden><div class="row-actions"><button type="button" class="btn sm" data-action="checkin">+ Check-in</button></div>
        ${ci.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th class="num">Sleep</th><th class="num">Steps</th><th class="num">Mood</th><th class="num">Energy</th><th class="num">Weight</th><th class="num">BP</th><th></th></tr></thead><tbody>${ci.map((c) => `<tr><td>${c.date}</td><td class="num">${v(c.sleep, 'h')}</td><td class="num">${ok(c.steps) ? fmt.num(c.steps) : '–'}</td><td class="num">${v(c.mood)}</td><td class="num">${v(c.energy)}</td><td class="num">${v(c.weight)}</td><td class="num">${c.sys && c.dia ? c.sys + '/' + c.dia : '–'}</td><td class="num nowrap"><button type="button" class="icon-sm" data-action="checkin" data-date="${c.date}" aria-label="Edit">✎</button><button type="button" class="icon-sm" data-del-ci="${c.date}" aria-label="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No check-ins yet.</p>'}</div>
      <div data-ep="pp" hidden><div class="row-actions"><button type="button" class="btn sm" data-action="log-contact">+ Log contact</button><button type="button" class="btn ghost sm" data-action="add-person">Edit people</button></div>
        ${logs.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Who</th><th>How</th><th>Note</th><th></th></tr></thead><tbody>${logs.map((l) => `<tr><td>${l.date}</td><td>${esc(l.who)}</td><td>${esc(l.type)}</td><td class="trunc">${esc(l.note || '')}</td><td class="num"><button type="button" class="icon-sm" data-del-log="${l.pid}|${l.id}" aria-label="Delete">✕</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No contacts logged yet.</p>'}</div>
      <div data-ep="gl" hidden><div class="row-actions"><button type="button" class="btn sm" data-action="goal-progress">Update progress</button><button type="button" class="btn ghost sm" data-action="add-goal">Edit goals</button><button type="button" class="btn ghost sm" data-action="edit-habits">Edit habits</button></div>
        <ul class="plain">${d.goals.map((g) => `<li><b>${esc(g.name)}</b> · ${g.progress || 0}%${g.targetDate ? ' · due ' + g.targetDate : ''}</li>`).join('') || '<li class="muted">No goals.</li>'}</ul>
        <ul class="plain">${d.habits.map((h) => `<li>${esc(h.name)} · done ${(h.done || []).length} day${(h.done || []).length === 1 ? '' : 's'}</li>`).join('') || '<li class="muted">No habits.</li>'}</ul></div></div>`;
  }
  function wireEntries(el) {
    const tabs = $('#entTabs', el); if (!tabs) return;
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-et]'); if (!b) return; $$('[data-et]', tabs).forEach((x) => x.setAttribute('aria-selected', String(x === b))); $$('[data-ep]', el).forEach((p) => (p.hidden = p.dataset.ep !== b.dataset.et)); });
    const s = $('#txSearch', el); if (s) s.addEventListener('input', () => { const q = s.value.toLowerCase().trim(); $$('#txTable tbody tr', el).forEach((r) => (r.hidden = q && !r.dataset.q.includes(q))); });
    el.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-del-tx]'), c = e.target.closest('[data-del-ci]'), l = e.target.closest('[data-del-log]');
      if (t && await confirmBox({ title: 'Delete this transaction?', body: 'This can\'t be undone.', okLabel: 'Delete', danger: true })) { S.update((d) => { d.finance.transactions = d.finance.transactions.filter((x) => x.id !== t.dataset.delTx); }, 'tx-del'); toast('Deleted'); }
      if (c && await confirmBox({ title: 'Delete this check-in?', body: esc(c.dataset.delCi), okLabel: 'Delete', danger: true })) { S.update((d) => { d.health.checkins = d.health.checkins.filter((x) => x.date !== c.dataset.delCi); }, 'checkin-del'); toast('Deleted'); }
      if (l && await confirmBox({ title: 'Delete this contact log?', body: 'This can\'t be undone.', okLabel: 'Delete', danger: true })) { const [pid, id] = l.dataset.delLog.split('|'); S.update((d) => { const p = d.people.find((x) => x.id === pid); if (p) p.log = p.log.filter((x) => x.id !== id); }, 'log-del'); toast('Deleted'); }
    });
  }

  // ---------- AI settings ----------
  function aiCard() {
    const cfg = S.getAI(), P = E.twin.PROVIDERS, p = cfg.provider || 'local';
    const radio = (v, title, sub) => `<label class="ai-opt"><input type="radio" name="aiProv" value="${v}" ${p === v ? 'checked' : ''}/><span><b>${title}</b><small>${sub}</small></span></label>`;
    const keyPanel = (k) => { const has = !!cfg[k + 'Key'], models = cfg[k + 'Models'] || [];
      return `<div class="ai-panel" data-panel="${k}" ${p === k || (cfg.view === k) ? '' : 'hidden'}>
        <p class="small">1. Get a free key at <a href="${P[k].keyUrl}" target="_blank" rel="noopener noreferrer">${P[k].keyUrl.replace('https://', '')}</a> (no credit card needed for the free tier). 2. Paste it here.</p>
        <div class="row-actions"><input type="password" name="${k}Key" autocomplete="off" spellcheck="false" placeholder="${has ? 'Key saved on this device ••••' + esc(cfg[k + 'Key'].slice(-4)) : 'Paste your ' + (k === 'gemini' ? 'Gemini' : 'Groq') + ' API key'}" aria-label="${k} API key"/>
          <button type="button" class="btn sm" data-ai-save="${k}">${has ? 'Replace & test' : 'Save & test'}</button>${has ? `<button type="button" class="btn ghost sm danger-text" data-ai-remove="${k}">Remove key</button>` : ''}</div>
        ${models.length ? fld('Model', `<select data-ai-model="${k}">${models.map((m) => opt(m, cfg[k + 'Model'])).join('')}</select>`, k === 'gemini' ? 'Only Flash / Flash-Lite models are on the free tier; if one says "quota 0", pick another.' : 'Free-tier models change; the list comes from your account.', 'sm') : ''}
        <p class="small muted">🔑 Your key is stored only in this browser (localStorage) and sent only to <b>${P[k].host}</b>, directly from your browser. Anyone with access to this browser profile could read it, so use a free-tier key and remove it on shared computers. ${P[k].privacy}</p></div>`; };
    return `<div class="card" id="aiCard"><h2>AI chat (optional)<small>${p === 'local' ? 'built-in, nothing sent' : esc(P[p] ? P[p].label : p)}</small></h2>
      <p class="muted small">Your twin works without any AI model: built-in logic answers from your numbers. To get free-form answers, connect a free model. There's no API key in this website; you bring your own, or run one on your device.</p>
      <div class="ai-opts" role="radiogroup" aria-label="Chat engine">
        ${radio('local', 'Built-in logic', 'Default. No network, no key. Answers common questions with exact numbers.')}
        ${radio('gemini', 'Google Gemini, your free key', 'Smart, fast. Free tier via Google AI Studio.')}
        ${radio('groq', 'Groq, your free key', 'Very fast open models (e.g. gpt-oss-20b). Free tier.')}
        ${radio('webllm', 'On-device model (WebLLM)', 'Private: runs on your GPU. One-time 200 MB–2 GB download. Needs WebGPU.')}
      </div>
      ${keyPanel('gemini')}${keyPanel('groq')}
      <div class="ai-panel" data-panel="webllm" ${p === 'webllm' ? '' : 'hidden'}>
        <p class="small" id="gpuStatus">Checking WebGPU…</p>
        ${fld('Model', `<select data-webllm-model>${E.twin.WEBLLM_MODELS.map((m) => opt(m.id, cfg.webllmModel || E.twin.WEBLLM_MODELS[0].id, m.label)).join('')}</select>`, 'Downloaded from Hugging Face once, then cached by your browser.')}
        <div class="row-actions"><button type="button" class="btn sm" data-webllm-load>Download &amp; start</button></div>
        <div class="progress" hidden id="wlProg"><i style="width:0%"></i></div><p class="small muted" id="wlText"></p></div>
      <label class="check small"><input type="checkbox" data-ai-raw ${cfg.includeRaw ? 'checked' : ''}/> Also send recent raw entries to Gemini/Groq (last 60 transactions, 30 check-ins, recent contact log). Off = only a summary of computed stats.</label></div>`;
  }
  function wireAI(el) {
    const card = $('#aiCard', el); if (!card) return;
    const cfg = () => S.getAI();
    const setCfg = (patch) => { S.setAI({ ...cfg(), ...patch }); app().refresh(true); };
    card.addEventListener('change', async (e) => {
      if (e.target.name === 'aiProv') {
        const v = e.target.value;
        $$('[data-panel]', card).forEach((pn) => (pn.hidden = pn.dataset.panel !== v));
        if (v === 'local') { setCfg({ provider: 'local' }); toast('Chat uses built-in logic. Nothing is sent anywhere.'); }
        else if ((v === 'gemini' || v === 'groq') && cfg()[v + 'Key']) { setCfg({ provider: v }); toast(`Chat now uses ${v === 'gemini' ? 'Gemini' : 'Groq'} with your key.`); }
        else if (v === 'webllm') gpuCheck(card);
        const keep = $(`input[name=aiProv][value="${v}"]`); if (keep) keep.checked = true;
      }
      if (e.target.dataset.aiModel) setCfg({ [e.target.dataset.aiModel + 'Model']: e.target.value });
      if (e.target.matches('[data-webllm-model]')) S.setAI({ ...cfg(), webllmModel: e.target.value });
      if (e.target.matches('[data-ai-raw]')) { S.setAI({ ...cfg(), includeRaw: e.target.checked }); toast(e.target.checked ? 'Recent raw entries will be included in AI prompts.' : 'Only a stats summary will be sent.'); }
    });
    card.addEventListener('click', async (e) => {
      const sv = e.target.closest('[data-ai-save]'), rm = e.target.closest('[data-ai-remove]'), wl = e.target.closest('[data-webllm-load]');
      if (sv) {
        const k = sv.dataset.aiSave, input = $(`input[name=${k}Key]`, card), key = input.value.trim();
        if (!key) { toast('Paste a key first', 'warn'); input.focus(); return; }
        sv.disabled = true; sv.textContent = 'Testing…';
        try {
          const models = await E.twin.listModels(k, key);
          if (!models.length) throw new Error('no chat models available for this key');
          const prevModel = cfg()[k + 'Model'];
          S.setAI({ ...cfg(), provider: k, [k + 'Key']: key, [k + 'Models']: models, [k + 'Model']: models.includes(prevModel) ? prevModel : models[0] });
          toast(`Connected. Chat now uses ${k === 'gemini' ? 'Gemini' : 'Groq'} (${models.includes(prevModel) ? prevModel : models[0]}).`);
          app().refresh(true); app().show('data', false); setTimeout(() => $('#aiCard') && $('#aiCard').scrollIntoView({ block: 'start' }), 50);
        } catch (err) { toast(`Key test failed: ${String(err.message).slice(0, 120)}`, 'warn'); sv.disabled = false; sv.textContent = 'Save & test'; }
      }
      if (rm) { const k = rm.dataset.aiRemove; const c = cfg(); delete c[k + 'Key']; delete c[k + 'Models']; delete c[k + 'Model']; if (c.provider === k) c.provider = 'local';
        S.setAI(c); toast('Key removed from this browser'); app().refresh(true); app().show('data', false); }
      if (wl) {
        const st = await E.twin.webgpuStatus(); if (!st.ok) { toast(st.why, 'warn'); return; }
        const model = $('[data-webllm-model]', card).value, prog = $('#wlProg', card), txt = $('#wlText', card);
        wl.disabled = true; prog.hidden = false; txt.textContent = 'Starting download…';
        try {
          await E.twin.loadWebLLM(model, (r) => { $('i', prog).style.width = Math.round((r.progress || 0) * 100) + '%'; txt.textContent = r.text || ''; });
          S.setAI({ ...cfg(), provider: 'webllm', webllmModel: model }); txt.textContent = 'Ready. Chat now runs on your device.'; toast('On-device model ready'); app().refresh(true);
        } catch (err) { txt.textContent = 'Could not start: ' + err.message; wl.disabled = false; }
      }
    });
    if (cfg().provider === 'webllm') gpuCheck(card);
  }
  async function gpuCheck(card) {
    const st = await E.twin.webgpuStatus(), el = $('#gpuStatus', card); if (!el) return;
    el.innerHTML = st.ok ? `✓ WebGPU available${st.f16 ? '' : ' (no fp16; a slightly larger build will be used)'}. Works best on a laptop/desktop with 4 GB+ free memory.` : '✕ ' + esc(st.why);
    const b = $('[data-webllm-load]', card); if (b) b.disabled = !st.ok;
  }

  // ---------- welcome ----------
  function renderWelcome() {
    const d = S.get();
    $('#welcome').innerHTML = `<div class="welcome-inner">
      <svg class="logo big" viewBox="0 0 32 32" aria-hidden="true"><circle cx="12" cy="16" r="9" fill="none" stroke="url(#lg)" stroke-width="3"/><circle cx="20" cy="16" r="9" fill="none" stroke="url(#lg)" stroke-width="3" opacity=".75"/></svg>
      <h1>Your life, mirrored.</h1>
      <p class="lead">Evenself turns your money, health, relationships and goals into one dashboard, a Life Score and an AI twin you can ask things like "can I afford this?" or "who should I call?"</p>
      <div class="choices">
        <button type="button" class="choice" data-action="demo"><span class="ch-ico">👀</span><b>Try the demo</b><small>Jordan Ellis, 31, a fictional persona with 6 months of made-up data</small></button>
        <button type="button" class="choice primary" data-action="create"><span class="ch-ico">✨</span><b>${d && d.onboarded ? 'Continue with my twin' : d ? 'Finish creating my twin' : 'Create my twin'}</b><small>About 3 minutes. Every step is optional.</small></button>
      </div>
      <ul class="trust"><li>🔒 Your data stays in this browser, on this device</li><li>🚫 No account, no server, no analytics or trackers</li><li>⬇️ Export or delete everything any time</li></ul>
      <p class="fine">Not medical, financial or legal advice. <button type="button" class="link-btn" data-action="privacy">How privacy works</button></p></div>`;
  }

  // ---------- global actions ----------
  function act(a, ds = {}) {
    const d = S.get(), onboarded = d && d.onboarded;
    const needUser = ['add-tx', 'edit-tx', 'checkin', 'log-contact', 'goal-progress', 'import-csv', 'add-person', 'add-goal', 'edit-finance', 'edit-health', 'edit-habits', 'edit-profile'];
    if (needUser.includes(a) && !onboarded) return openWizard(0);
    if (needUser.includes(a) && app().mode !== 'user') app().setMode('user', { noScroll: true });
    switch (a) {
      case 'create': if (onboarded) app().setMode('user'); else openWizard(0); break;
      case 'demo': app().setMode('demo'); break;
      case 'add-tx': openSheet('tx'); break;
      case 'edit-tx': openSheet('tx', { id: ds.id }); break;
      case 'checkin': openSheet('checkin', { date: ds.date }); break;
      case 'log-contact': openSheet('contact', { id: ds.id }); break;
      case 'goal-progress': openSheet('goal', { id: ds.id }); break;
      case 'import-csv': openSheet('csv'); break;
      case 'add-person': closeSheet(); openEdit(3, { addRow: !(d.people || []).length }); break;
      case 'add-goal': closeSheet(); openEdit(4, { addRow: true }); break;
      case 'edit-profile': openEdit(0); break;
      case 'edit-finance': openEdit(1); break;
      case 'edit-health': openEdit(2); break;
      case 'edit-habits': openEdit(5, { addRow: !(d.habits || []).length }); break;
      case 'goto-data': app().show('data'); scrollTabs(); break;
      case 'ai-settings': document.body.classList.remove('chat-open'); app().show('data'); setTimeout(() => $('#aiCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); break;
      case 'privacy': document.body.classList.remove('show-welcome'); app().show('data'); setTimeout(() => $('#privacy').scrollIntoView({ block: 'start' }), 60); break;
      default:
    }
  }
  const closeSheet = () => { const s = $('#sheet'); if (s.open) s.close(); };
  const scrollTabs = () => document.querySelector('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-action]'); if (!b) return; e.preventDefault(); act(b.dataset.action, b.dataset); });
  // click on the dimmed backdrop closes a dialog
  document.addEventListener('click', (e) => { if (e.target.tagName === 'DIALOG' && e.target.open && e.target.id !== 'confirmDlg') e.target.close(); });

  E.ui = { openWizard, openEdit, openSheet, renderDataTab, renderWelcome, toast, confirmBox, exportJSON, act };
})();
