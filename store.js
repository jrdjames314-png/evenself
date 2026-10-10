/* Evenself: the single data store.
   - Demo mode reads the fictional persona (persona.js), untouched.
   - "My data" mode reads the visitor's own entries from localStorage (key evenself-user-v1).
   Nothing in this file (or anywhere in the site) sends user data over the network.
   toInput() converts the visitor's entries into the same shape analytics.js already understands,
   so the dashboard, insights, Life Score and chat all run on one code path. */
(function () {
  'use strict';
  const E = (window.Evenself = window.Evenself || {});
  const KEY = 'evenself-user-v1', MODE_KEY = 'evenself-mode', AI_KEY = 'evenself-ai';
  const DAY = 86400000;

  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayISO = () => isoLocal(new Date());
  const shiftISO = (s, days) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + days); return isoLocal(d); };
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
  const num = (v) => { if (v === '' || v === null || v === undefined) return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const CATEGORIES = ['Housing', 'Utilities', 'Groceries', 'Dining', 'Transport', 'Subscriptions', 'Shopping', 'Health & Fitness',
    'Entertainment', 'Travel', 'Gifts', 'Pets', 'Education', 'Insurance', 'Personal care', 'Other'];
  const SPECIAL = ['Income', 'Savings transfers', 'Debt payments'];
  const ESSENTIAL = ['Housing', 'Utilities', 'Groceries', 'Transport', 'Subscriptions', 'Pets', 'Health & Fitness', 'Insurance'];

  // keyword -> category (first match wins; order matters: "uber eats" is dining before "uber" is transport)
  const KEYWORDS = [
    [/(payroll|salary|direct dep|paycheck|pay check|wages|refund|dividend|interest paid|venmo from|zelle from)/i, 'Income'],
    [/(transfer to sav|to savings|savings transfer|to emergency|round.?up)/i, 'Savings transfers'],
    [/(loan pay|student loan|credit card pay|card payment|car payment|auto loan|navient|nelnet|sallie mae)/i, 'Debt payments'],
    [/(rent\b|mortgage|landlord|apartment|property mgmt|hoa\b)/i, 'Housing'],
    [/(uber ?eats|doordash|grubhub|postmates|restaurant|cafe|café|coffee|starbucks|dunkin|mcdonald|chipotle|pizza|taco|burger|sushi|diner|bistro|grill|bar & |kitchen|chick-fil|subway|panera|wendy)/i, 'Dining'],
    [/(grocer|safeway|kroger|whole foods|trader joe|aldi|costco|supermarket|heb\b|h-e-b|publix|wegmans|fred meyer|food lion|sprouts|market)/i, 'Groceries'],
    [/(electric|energy|water bill|gas bill|internet|comcast|xfinity|verizon|at&t|t-mobile|tmobile|utility|utilities|pg&e|spectrum|phone bill|mint mobile)/i, 'Utilities'],
    [/(uber|lyft|shell\b|chevron|exxon|mobil|arco|fuel|gas station|parking|transit|metro|toll|car wash|jiffy|dmv|bp\b)/i, 'Transport'],
    [/(netflix|spotify|hulu|disney\+|disney plus|youtube|prime video|amazon prime|icloud|apple\.com|google one|subscription|patreon|chatgpt|openai|adobe|max\.com|hbo)/i, 'Subscriptions'],
    [/(insurance|geico|progressive|state farm|allstate|lemonade)/i, 'Insurance'],
    [/(gym|fitness|pharmacy|cvs|walgreens|doctor|dental|dentist|clinic|hospital|yoga|peloton|planet fitness)/i, 'Health & Fitness'],
    [/(vet\b|veterinar|petco|petsmart|chewy|pet )/i, 'Pets'],
    [/(movie|cinema|amc |concert|ticketmaster|tickets|steam|playstation|xbox|nintendo|bowling|museum)/i, 'Entertainment'],
    [/(airline|airlines|flight|hotel|airbnb|delta|united|southwest|alaska air|expedia|booking\.com|marriott|hilton)/i, 'Travel'],
    [/(gift|flowers|florist|hallmark)/i, 'Gifts'],
    [/(tuition|course|udemy|coursera|textbook|school|college)/i, 'Education'],
    [/(salon|barber|haircut|spa\b|nails|sephora|ulta)/i, 'Personal care'],
    [/(amazon|amzn|target|walmart|best buy|ikea|etsy|ebay|clothing|zara|h&m|nike|uniqlo|old navy|home depot|lowe'?s|shop)/i, 'Shopping'],
  ];
  function categorize(text, fallback = 'Other') {
    const s = String(text || '');
    for (const [re, cat] of KEYWORDS) if (re.test(s)) return cat;
    return fallback;
  }

  function blank() {
    return {
      schema: 'evenself-user', version: 1, createdAt: todayISO(), updatedAt: new Date().toISOString(), onboarded: false,
      profile: { name: '', age: null, city: '', occupation: '', goalsText: '' },
      finance: { currency: 'USD', monthlyIncome: null, autoBills: true, bills: [], accounts: [], debts: [], budgets: {},
        creditScores: [], transactions: [], netWorthLog: [], emergencyMonthsTarget: 6 },
      health: { sleepTarget: 7.5, stepsGoal: 8000, weightUnit: 'lb', weightGoal: null, heightIn: null, trackBP: false, checkins: [] },
      people: [], goals: [], habits: [],
    };
  }

  // ---------- persistence ----------
  const listeners = new Set();
  let cache = null;
  function storageOK() { try { localStorage.setItem('evenself-probe', '1'); localStorage.removeItem('evenself-probe'); return true; } catch (e) { return false; } }
  function load() {
    if (cache) return cache;
    try { const raw = localStorage.getItem(KEY); if (raw) cache = migrate(JSON.parse(raw)); } catch (e) { cache = null; }
    return cache;
  }
  function migrate(d) {
    // fill in any missing fields so older/partial files keep working
    const b = blank();
    const out = Object.assign(b, d);
    out.profile = Object.assign(b.profile, d.profile || {});
    out.finance = Object.assign(blank().finance, d.finance || {});
    out.health = Object.assign(blank().health, d.health || {});
    ['people', 'goals', 'habits'].forEach((k) => { if (!Array.isArray(out[k])) out[k] = []; });
    ['bills', 'accounts', 'debts', 'creditScores', 'transactions', 'netWorthLog'].forEach((k) => { if (!Array.isArray(out.finance[k])) out.finance[k] = []; });
    if (!Array.isArray(out.health.checkins)) out.health.checkins = [];
    out.people.forEach((p) => { if (!Array.isArray(p.log)) p.log = []; if (!p.id) p.id = uid(); });
    out.habits.forEach((h) => { if (!Array.isArray(h.done)) h.done = []; if (!h.id) h.id = uid(); });
    out.goals.forEach((g) => { if (!g.id) g.id = uid(); });
    return out;
  }
  function snapshot(d) {
    // monthly net-worth and credit-score history, recorded as the visitor updates balances
    const m = todayISO().slice(0, 7), F = d.finance;
    const assets = F.accounts.reduce((s, a) => s + (num(a.balance) || 0), 0);
    const debt = F.debts.reduce((s, x) => s + (num(x.balance) || 0), 0);
    if (F.accounts.length || F.debts.length) {
      const nw = Math.round(assets - debt), i = F.netWorthLog.findIndex((x) => x.month === m);
      if (i >= 0) F.netWorthLog[i].netWorth = nw; else F.netWorthLog.push({ month: m, netWorth: nw });
      F.netWorthLog.sort((a, b) => a.month.localeCompare(b.month));
    }
  }
  function save(d, why) {
    d.updatedAt = new Date().toISOString();
    snapshot(d);
    cache = d;
    localStorage.setItem(KEY, JSON.stringify(d));
    listeners.forEach((fn) => fn(d, why));
    return d;
  }
  function get() { return load(); }
  function create() { const d = blank(); return save(d, 'create'); }
  function update(fn, why) { const d = load() || blank(); fn(d); return save(d, why || 'update'); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function getMode() { try { return localStorage.getItem(MODE_KEY); } catch (e) { return null; } }
  function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* private mode */ } }

  function deleteAll() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('evenself-') && k !== 'evenself-theme').forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    cache = null;
    // WebLLM model files (if the visitor downloaded one) live in Cache Storage / IndexedDB
    try { if (window.caches) caches.keys().then((ks) => ks.filter((k) => /webllm|tvmjs/i.test(k)).forEach((k) => caches.delete(k))); } catch (e) { /* ignore */ }
    listeners.forEach((fn) => fn(null, 'delete'));
  }

  // ---------- export / import ----------
  function exportData() {
    const d = load();
    return { exportedAt: new Date().toISOString(), app: 'Evenself', note: 'Your Evenself data. Keep it private.', data: d };
  }
  function importData(obj) {
    const d = obj && obj.data ? obj.data : obj;
    if (!d || d.schema !== 'evenself-user') throw new Error("This doesn't look like an Evenself backup file.");
    const m = migrate(clone(d));
    m.onboarded = true;
    return save(m, 'import');
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = String(text).replace(/^\uFEFF/, '');
    const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
    return rows.map((r) => r.map((x) => x.trim()));
  }
  function guessMapping(headers) {
    const h = headers.map((x) => x.toLowerCase());
    const find = (re) => h.findIndex((x) => re.test(x));
    const debit = find(/^(debit|withdrawal|money out|outflow)/), credit = find(/^(credit|deposit|money in|inflow)/);
    return {
      date: find(/date|posted|time/), description: find(/desc|merchant|payee|name|memo|details|narrative/),
      amount: find(/^amount|amount|value|sum/), category: find(/categ|type/), debit, credit,
    };
  }
  function parseDate(s) {
    s = String(s || '').trim();
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; let a = +m[1], b = +m[2]; // US month/day unless impossible
      let mo = a, da = b; if (a > 12) { mo = b; da = a; }
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null; return `${y}-${pad(mo)}-${pad(da)}`; }
    const d = new Date(s); return isNaN(d) ? null : isoLocal(d);
  }
  const normCat = (c) => { if (!c) return null; const all = CATEGORIES.concat(SPECIAL); const f = all.find((x) => x.toLowerCase() === String(c).toLowerCase().trim()); return f || null; };
  /** rows (without header) + mapping -> transactions. sign: 'neg-expense' (bank style: -42.10 is spending) | 'pos-expense' */
  function rowsToTransactions(rows, map, sign = 'neg-expense') {
    const out = [], skipped = [];
    rows.forEach((r, i) => {
      const date = parseDate(r[map.date]);
      let amt = map.amount >= 0 ? num(String(r[map.amount]).replace(/^\((.*)\)$/, '-$1')) : null;
      if (amt === null && (map.debit >= 0 || map.credit >= 0)) {
        const d = num(r[map.debit]), c = num(r[map.credit]);
        amt = d ? -Math.abs(d) : c ? Math.abs(c) : null; sign = 'neg-expense';
      }
      if (!date || amt === null || amt === 0) { skipped.push(i + 2); return; }
      const desc = map.description >= 0 ? r[map.description] : '';
      const isExpense = sign === 'neg-expense' ? amt < 0 : amt > 0;
      let cat = normCat(map.category >= 0 ? r[map.category] : null) || categorize(desc, isExpense ? 'Other' : 'Income');
      if (!isExpense && cat !== 'Income') cat = /refund|return/i.test(desc) ? 'Income' : 'Income';
      if (isExpense && cat === 'Income') cat = categorize(desc.replace(/(refund|deposit)/ig, ''), 'Other');
      out.push({ id: uid(), date, amount: Math.round(Math.abs(amt) * 100) / 100, category: cat, note: desc.slice(0, 80), source: 'csv' });
    });
    return { transactions: out, skipped };
  }

  // ---------- user data -> analytics input (persona-shaped) ----------
  const RELS = { partner: /(partner|spouse|wife|husband|girlfriend|boyfriend|fianc)/i, family: /(mom|dad|mother|father|sister|brother|sibling|grand|aunt|uncle|cousin|son|daughter|parent|family|niece|nephew)/i };
  function groupOf(rel) { return RELS.partner.test(rel) ? 'partner' : RELS.family.test(rel) ? 'family' : /mentor|boss|cowork|colleague|manager/i.test(rel) ? 'work' : 'friends'; }
  const CLOSENESS = { partner: 10, family: 8, friends: 6, work: 5 };
  function nextBirthday(b, asOf) {
    if (!b) return null; const m = String(b).match(/(\d{1,2})-(\d{1,2})$/); if (!m) return null;
    const y = +asOf.slice(0, 4); let d = `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    if (d < asOf) d = `${y + 1}-${pad(+m[1])}-${pad(+m[2])}`; return d;
  }
  const monthKey = (s) => s.slice(0, 7);
  const addMonths = (k, n) => { const d = new Date(+k.slice(0, 4), +k.slice(5, 7) - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const minDate = (arr, fallback) => arr.reduce((m, x) => (x && x < m ? x : m), fallback);

  function toInput(d, asOf) {
    asOf = asOf || todayISO();
    const F = d.finance, H = d.health, cur = monthKey(asOf);
    const txs = F.transactions.filter((t) => t.date && t.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date));
    const start = monthKey(minDate(txs.map((t) => t.date), d.createdAt || asOf));
    const months = []; for (let k = start; k <= cur; k = addMonths(k, 1)) months.push(k);

    const spendTx = txs.filter((t) => t.category !== 'Income').map((t) => ({ date: t.date, category: t.category, merchant: t.note || t.category, amount: +t.amount, id: t.id }));
    const fixedMonthly = (F.autoBills ? F.bills.reduce((s, b) => s + (num(b.amount) || 0), 0) + F.debts.reduce((s, x) => s + (num(x.minPayment) || 0), 0) : 0);
    if (F.autoBills) {
      months.forEach((m) => {
        F.bills.forEach((b) => { const day = Math.min(28, Math.max(1, +b.day || 1)); const date = `${m}-${pad(day)}`; if (date <= asOf && num(b.amount)) spendTx.push({ date, category: b.category || 'Other', merchant: b.name + ' (recurring)', amount: num(b.amount), auto: true }); });
        F.debts.forEach((x) => { const date = `${m}-${pad(Math.min(28, Math.max(1, +x.day || 1)))}`; if (date <= asOf && num(x.minPayment)) spendTx.push({ date, category: 'Debt payments', merchant: x.name + ' minimum (recurring)', amount: num(x.minPayment), auto: true }); });
      });
    }
    spendTx.sort((a, b) => a.date.localeCompare(b.date));
    const income = txs.filter((t) => t.category === 'Income').map((t) => ({ date: t.date, source: t.note || 'Income', amount: +t.amount }));
    const incomeEstimated = [];
    // months with no logged pay use the take-home from the profile; the current month uses whichever is larger
    // (people often log one paycheck of two before the month ends)
    if (num(F.monthlyIncome)) months.forEach((m) => {
      const logged = income.filter((i) => monthKey(i.date) === m).reduce((s, i) => s + i.amount, 0);
      const gap = m === cur ? num(F.monthlyIncome) - logged : logged ? 0 : num(F.monthlyIncome);
      if (gap > 0) { income.push({ date: m + '-01', source: 'Monthly take-home (from your profile)', amount: gap, estimated: true }); incomeEstimated.push(m); }
    });

    const budget = {};
    Object.entries(F.budgets || {}).forEach(([c, v]) => { if (num(v)) budget[c] = num(v); });
    if (F.autoBills) F.bills.forEach((b) => { const c = b.category || 'Other'; if (!(c in (F.budgets || {})) || !num(F.budgets[c])) budget[c] = (budget[c] || 0) + (num(b.amount) || 0); });

    const accounts = F.accounts.filter((a) => num(a.balance) !== null).map((a) => ({ name: a.name || a.type, type: a.type || 'savings', balance: num(a.balance) }));
    const debts = F.debts.filter((x) => num(x.balance) !== null).map((x) => ({ name: x.name || 'Debt', balance: num(x.balance), apr: num(x.apr) || 0, minPayment: num(x.minPayment) || 0, limit: num(x.limit) || undefined, kind: x.kind }));
    const credit = F.creditScores.filter((c) => num(c.score)).map((c) => ({ month: c.month, score: num(c.score) })).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);

    const daily = H.checkins.filter((c) => c.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date)).map((c) => ({
      date: c.date, sleepHours: num(c.sleep), steps: num(c.steps), weightLb: num(c.weight), mood: num(c.mood), energy: num(c.energy) }));
    const bp = H.checkins.filter((c) => num(c.sys) && num(c.dia) && c.date <= asOf).sort((a, b) => a.date.localeCompare(b.date)).map((c) => ({ date: c.date, systolic: num(c.sys), diastolic: num(c.dia) }));

    const contacts = d.people.map((p) => {
      const group = groupOf(p.relation || '');
      const interactions = (p.log || []).filter((l) => l.date <= asOf).slice().sort((a, b) => a.date.localeCompare(b.date)).map((l) => ({ date: l.date, type: l.type || 'chat' }));
      return { id: p.id, name: p.name, relation: p.relation || 'Friend', group, targetEveryDays: Math.max(1, num(p.everyDays) || 14), closeness: num(p.closeness) || CLOSENESS[group],
        notes: p.notes || '', interactions, added: p.added || d.createdAt || asOf, birthday: p.birthday || null };
    });
    const importantDates = contacts.filter((c) => c.birthday).map((c) => ({ label: `${c.name.split(' ')[0]}'s birthday`, date: nextBirthday(c.birthday, asOf), contact: c.name, type: 'birthday' })).filter((e) => e.date);

    const goals = d.goals.map((g) => ({ id: g.id, name: g.name, area: g.area || 'personal', progress: Math.max(0, Math.min(100, Math.round(num(g.progress) || 0))), due: g.targetDate || null, milestones: [] }));
    const habits = d.habits.map((h) => {
      const from = [shiftISO(asOf, -29), h.created || d.createdAt || asOf].sort()[1];
      const set = new Set(h.done || []), log = [];
      for (let x = from; x <= asOf; x = shiftISO(x, 1)) { if (x === asOf && !set.has(x)) break; log.push({ date: x, done: set.has(x) }); }
      return { id: h.id, name: h.name, log };
    });

    const name = d.profile.name || 'You';
    return {
      meta: { asOf, fictional: false, user: true },
      profile: { name, firstName: name.split(' ')[0], age: num(d.profile.age), city: d.profile.city || '', occupation: d.profile.occupation || '', bio: d.profile.goalsText || '' },
      finance: { currency: F.currency || 'USD', salaryAnnual: num(F.monthlyIncome) ? num(F.monthlyIncome) * 12 : null, netMonthlyIncome: num(F.monthlyIncome),
        emergencyFundTargetMonths: num(F.emergencyMonthsTarget) || 6, monthlyBudget: budget, income, incomeEstimated, transactions: spendTx, fixedMonthly,
        accounts, debts, creditScore: credit, netWorthHistory: F.netWorthLog.slice(-12), savingsGoals: [], startMonth: start, userTxCount: txs.length },
      health: { heightIn: num(H.heightIn), unit: H.weightUnit || 'lb', goals: { sleepHours: num(H.sleepTarget) || 7.5, steps: num(H.stepsGoal) || 8000, workoutsPerWeek: null, targetWeightLb: num(H.weightGoal) },
        daily, workouts: [], bloodPressure: bp },
      relationships: { contacts, importantDates },
      career: { role: d.profile.occupation || '', goals, salaryHistory: [], skills: [], focusHoursByWeek: [] },
      habits,
    };
  }

  // ---------- settings for the optional AI chat (kept separate from life data) ----------
  function getAI() { try { return Object.assign({ provider: 'local', includeRaw: false }, JSON.parse(localStorage.getItem(AI_KEY) || '{}')); } catch (e) { return { provider: 'local' }; } }
  function setAI(cfg) { localStorage.setItem(AI_KEY, JSON.stringify(cfg)); }

  E.store = { KEY, CATEGORIES, SPECIAL, ESSENTIAL, uid, num, todayISO, shiftISO, categorize, blank, load, get, create, save, update, onChange,
    getMode, setMode, deleteAll, exportData, importData, parseCSV, guessMapping, parseDate, rowsToTransactions, toInput, storageOK, getAI, setAI, nextBirthday };
})();
