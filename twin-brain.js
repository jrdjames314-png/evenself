/* Evenself: the "AI twin" chat brain.

   Three ways to answer, all through ONE function, askTwin(question, model, history):
   1. 'local' (default): a built-in intent matcher that answers from the computed twin model (analytics.js).
      No network, no key. Every number in a reply comes from the active data (demo persona or the visitor's own).
   2. 'gemini' / 'groq': BRING YOUR OWN FREE KEY. The visitor pastes their own free-tier key; it is stored only in
      this browser (localStorage) and sent only to that provider, directly from the browser (both allow CORS).
      By default the prompt carries a compact summary of computed stats (buildTwinContext), not raw logs.
   3. 'webllm': an open model downloaded once and run on the visitor's own GPU (WebGPU). Nothing leaves the device.
   Any failure falls back to the built-in answer, so chat always works. There is no API key anywhere in this site. */
(function () {
  'use strict';
  const E = window.Evenself, { fmt } = E, ok = E.util.ok;

  const PROVIDERS = {
    gemini: { label: 'Google Gemini (free tier)', keyUrl: 'https://aistudio.google.com/app/apikey', host: 'generativelanguage.googleapis.com',
      privacy: 'On Google\'s free tier, Google may use prompts and responses to improve its products. Use a paid key, or the on-device option, if that matters to you.' },
    groq: { label: 'Groq (free tier)', keyUrl: 'https://console.groq.com/keys', host: 'api.groq.com',
      privacy: 'Groq processes the prompt on its servers under its own privacy policy.' },
    webllm: { label: 'On-device model (WebLLM)', host: 'huggingface.co (model download only)', privacy: 'Runs on your GPU. After the one-time download nothing is sent anywhere.' },
  };
  const WEBLLM_URL = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm';
  const WEBLLM_MODELS = [
    { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B (≈700 MB download, recommended)' },
    { id: 'SmolLM2-360M-Instruct-q4f16_1-MLC', label: 'SmolLM2 360M (≈200 MB, fastest, weakest)' },
    { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B (≈2.3 GB, best answers, needs a strong GPU)' },
  ];

  /** THE swap point. Returns {text, disclaimer?: 'finance'|'health', source, note?}. */
  async function askTwin(question, model, history = [], opts = {}) {
    const local = { ...localTwinReply(question, model), source: 'local' };
    const cfg = E.store ? E.store.getAI() : { provider: 'local' };
    if (!cfg.provider || cfg.provider === 'local') return local;
    try {
      const text = await askLLM(cfg, question, model, history, local, opts);
      if (!text || !text.trim()) throw new Error('empty answer');
      return { text: text.trim(), disclaimer: local.disclaimer || guessDisclaimer(question), source: cfg.provider };
    } catch (err) {
      return { ...local, note: `AI unavailable (${String(err.message || err).slice(0, 140)}), so this is the built-in answer.` };
    }
  }

  function systemPrompt(M, cfg) {
    return [
      `You are ${M.profile.firstName || 'the user'}'s "AI twin" inside Evenself, a personal life dashboard${M.isDemo ? ' (currently showing a FICTIONAL demo persona)' : ''}.`,
      'Speak to the user as "you". Be warm, specific and brief: under 130 words, plain sentences, optional "• " bullets, **bold** for key numbers.',
      'Use ONLY facts in CONTEXT and BUILT-IN ANALYSIS. Never invent numbers, people, accounts or dates. If something is missing, say which entry would unlock it (e.g. "add a check-in", "add your savings balance").',
      'You are not a doctor, lawyer or financial adviser. For health or money questions add one short line suggesting a professional for decisions. For anything urgent or about self-harm, tell them to contact local emergency services or a crisis line.',
      `Today is ${M.asOf}. Money is in ${M.persona.finance.currency || 'USD'}; weight is in ${M.health.unit || 'lb'}.`,
      cfg.includeRaw ? 'RAW contains recent raw entries the user chose to share.' : '',
    ].filter(Boolean).join('\n');
  }

  function userPrompt(question, M, local, cfg) {
    const ctx = buildTwinContext(M, cfg.includeRaw);
    return `CONTEXT (computed stats as JSON):\n${JSON.stringify(ctx)}\n\nBUILT-IN ANALYSIS for this question (rule-based, numbers are reliable):\n${local.text}\n\nQUESTION: ${question}`;
  }

  async function askLLM(cfg, question, M, history, local, opts) {
    const sys = systemPrompt(M, cfg);
    const hist = history.slice(-6, -1).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 800) }));
    const user = userPrompt(question, M, local, cfg);
    const timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };
    if (cfg.provider === 'gemini') {
      if (!cfg.geminiKey) throw new Error('no Gemini key saved');
      const model = (cfg.geminiModel || 'gemini-flash-latest').replace(/^models\//, '');
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: timeout(45000), referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] },
          contents: hist.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })).concat([{ role: 'user', parts: [{ text: user }] }]),
          generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Gemini ${res.status}${data.error ? ': ' + data.error.message : ''}`);
      return ((data.candidates || [])[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    }
    if (cfg.provider === 'groq') {
      if (!cfg.groqKey) throw new Error('no Groq key saved');
      const model = cfg.groqModel || 'openai/gpt-oss-20b';
      const body = { model, temperature: 0.4, max_tokens: 1200, messages: [{ role: 'system', content: sys }, ...hist, { role: 'user', content: user }] };
      if (/gpt-oss/.test(model)) body.reasoning_effort = 'low';
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: timeout(45000), referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.groqKey }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Groq ${res.status}${data.error ? ': ' + data.error.message : ''}`);
      return data.choices?.[0]?.message?.content || '';
    }
    if (cfg.provider === 'webllm') {
      const engine = await loadWebLLM(cfg.webllmModel || WEBLLM_MODELS[0].id, opts.onProgress);
      // small models have small context windows: send the summary only, never raw logs
      const smallUser = `CONTEXT:\n${JSON.stringify(buildTwinContext(M, false))}\n\nBUILT-IN ANALYSIS:\n${local.text}\n\nQUESTION: ${question}`;
      const r = await engine.chat.completions.create({ messages: [{ role: 'system', content: sys }, ...hist.slice(-2), { role: 'user', content: smallUser }], temperature: 0.3, max_tokens: 350 });
      return r.choices?.[0]?.message?.content || '';
    }
    throw new Error('unknown provider');
  }

  // ---------- provider helpers (key test + model list) ----------
  async function listModels(provider, key) {
    if (provider === 'gemini') {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key }, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ? data.error.message : 'HTTP ' + res.status);
      const ids = (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, '')).filter((id) => /^gemini/.test(id) && /flash/.test(id) && !/(image|tts|audio|live|embedding|thinking-exp|vision)/.test(id));
      const ver = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
      ids.sort((a, b) => (/latest/.test(b) - /latest/.test(a)) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || ver(b) - ver(a) || (/lite/.test(a) - /lite/.test(b)));
      return ids;
    }
    if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + key }, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ? data.error.message : 'HTTP ' + res.status);
      const ids = (data.data || []).map((m) => m.id).filter((id) => !/(whisper|orpheus|guard|tts|safeguard|playai|compound)/i.test(id));
      const pref = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
      ids.sort((a, b) => ((pref.indexOf(a) + 1 || 99) - (pref.indexOf(b) + 1 || 99)) || a.localeCompare(b));
      return ids;
    }
    return [];
  }

  let enginePromise = null, engineModel = null;
  async function webgpuStatus() {
    if (!('gpu' in navigator)) return { ok: false, why: 'This browser has no WebGPU. Try recent Chrome or Edge on a laptop/desktop (Safari 26+ and some Android Chrome builds also work).' };
    try { const a = await navigator.gpu.requestAdapter(); if (!a) return { ok: false, why: 'WebGPU is present but no GPU adapter is available.' }; return { ok: true, f16: a.features.has('shader-f16') }; }
    catch (e) { return { ok: false, why: 'WebGPU error: ' + e.message }; }
  }
  async function loadWebLLM(modelId, onProgress) {
    const st = await webgpuStatus();
    if (!st.ok) throw new Error(st.why);
    const id = st.f16 ? modelId : modelId.replace('q4f16_1', 'q4f32_1');
    if (enginePromise && engineModel === id) return enginePromise;
    engineModel = id;
    enginePromise = (async () => {
      const webllm = await import(WEBLLM_URL);
      return webllm.CreateMLCEngine(id, { initProgressCallback: (r) => onProgress && onProgress(r) });
    })();
    enginePromise.catch(() => { enginePromise = null; engineModel = null; });
    return enginePromise;
  }

  /** Compact context for a real model: computed facts, not raw logs (unless includeRaw). */
  function buildTwinContext(M, includeRaw) {
    const F = M.finance, H = M.health, R = M.relationships, C = M.career;
    const r1 = (x, d = 1) => (ok(x) ? +x.toFixed(d) : null);
    const ctx = {
      asOf: M.asOf, demo: M.isDemo, profile: { name: M.profile.name, age: M.profile.age, city: M.profile.city, occupation: M.profile.occupation, goals: M.profile.bio },
      scores: M.scores,
      finance: { monthlyTakeHome: F.netMonthlyIncome, transactionsLogged: F.has.txCount, lastFullMonth: F.has.last ? F.last : null,
        spendByCategory: F.has.last ? roundObj(F.byMonthCat[F.last]) : roundObj(F.byMonthCat[F.cur]), spendBasis: F.has.last ? 'last full month' : 'this month so far',
        savingsRate: r1(F.rateNow, 3), savingsRateBasis: F.rateBasis, typicalMonthlyLeftover: ok(F.surplus3) ? Math.round(F.surplus3) : null,
        checking: F.checking, emergencyFund: F.efund, emergencyFundMonths: r1(F.efundMonths), netWorth: Math.round(F.netWorth),
        overBudget: F.overBudget.map((b) => ({ cat: b.cat, budget: b.budget, actual: Math.round(b.actual) })),
        debts: F.debts.map((d) => ({ name: d.name, balance: d.balance, apr: d.apr })), creditScore: F.creditNow, cardUtilization: r1(F.utilization, 2) },
      health: { daysLogged: H.daily.length, sleepAvg14: r1(H.sleep14, 2), shortNights14: H.shortNights, sleepGoal: H.goals.sleepHours, steps7: ok(H.steps7) ? Math.round(H.steps7) : null, stepsGoal: H.goals.steps,
        weightAvg7: r1(H.wNow), weightGoal: H.goals.targetWeightLb, unit: H.unit, bp: ok(H.sys) ? [Math.round(H.sys), Math.round(H.dia)] : null, bpCategory: H.bpCat,
        workoutsPerWeek: H.workoutsPerWeek, mood14: r1(H.mood14, 2), energy14: r1(H.energy14, 2), moodOnGoodSleep: r1(H.moodGoodSleep), moodOnShortSleep: r1(H.moodBadSleep) },
      relationships: R.contacts.map((c) => ({ name: c.name, relation: c.relation, daysSinceContact: c.daysSince, contactLogged: !c.neverLogged, targetEveryDays: c.targetEveryDays, notes: c.notes || undefined })),
      upcomingDates: R.upcoming.slice(0, 5).map((e) => ({ label: e.label, date: e.date, inDays: e.inDays })),
      goals: C.goals.map((g) => ({ name: g.name, area: g.area, progress: g.progress, due: g.due, daysLeft: g.daysLeft })),
      habits: M.habits.list.map((h) => ({ name: h.name, rate14: r1(h.rate14, 2), streak: h.streak })),
    };
    if (ok(C.salary)) ctx.career = { role: C.role, salary: C.salary, marketMid: C.marketRange && C.marketRange.mid, nextReview: C.nextReview };
    if (includeRaw) ctx.RAW = {
      transactions: F.transactions.filter((t) => !t.auto).slice(-60).map((t) => [t.date, t.category, t.merchant, t.amount]),
      checkins: H.daily.slice(-30), contactLog: R.contacts.map((c) => ({ name: c.name, log: c.interactions.slice(-5) })),
    };
    return ctx;
  }
  const roundObj = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v)]));

  // ---------------- built-in intent matcher ----------------
  const CAT_WORDS = [
    [/\b(food|eat(ing)?|meals?)\b/, ['Groceries', 'Dining'], 'food (groceries + dining)'],
    [/(dining|restaurant|eat(ing)? out|take ?out|doordash|coffee|delivery)/, ['Dining'], 'dining out'],
    [/grocer/, ['Groceries'], 'groceries'],
    [/(rent|housing)/, ['Housing'], 'rent'],
    [/(transport|gas|uber|lyft|car\b|commut|parking)/, ['Transport'], 'transport'],
    [/subscri/, ['Subscriptions'], 'subscriptions'],
    [/(shopping|amazon|clothes|stuff)/, ['Shopping'], 'shopping'],
    [/(entertain|fun|concert|movie|games?)/, ['Entertainment'], 'entertainment'],
    [/(travel|flight|hotel)/, ['Travel'], 'travel'],
    [/(pet|dog|biscuit|vet)/, ['Pets'], 'pets'],
    [/(utilit|electric|internet|phone bill)/, ['Utilities'], 'utilities'],
    [/(gym|fitness)/, ['Health & Fitness'], 'health & fitness'],
    [/gift/, ['Gifts'], 'gifts'],
  ];

  function parseAmount(q) {
    const m = q.replace(/,/g, '').match(/\$\s?(\d+(?:\.\d+)?)\s*(k)?|(\d+(?:\.\d+)?)\s*(k|dollars|bucks|usd)\b/i);
    if (!m) return null;
    const n = parseFloat(m[1] || m[3]); const k = (m[2] || m[4] || '').toLowerCase() === 'k';
    return k ? n * 1000 : n;
  }
  const bullet = (arr) => arr.filter(Boolean).map((x) => '• ' + x).join('\n');
  const ago = (n) => (n === 0 ? '**today**' : `**${fmt.days(n)} ago**`);
  const every = (n) => (n === 1 ? 'every day' : `every ${n} days`);
  const need = (what) => ({ text: `I don't have enough data for that yet. ${what}` });
  const lastContact = (c) => c.neverLogged ? `No contact with ${E.who(c)} logged yet (added ${fmt.date(c.last.date)}, ${fmt.days(c.daysSince)} ago)` : `Last contact with ${E.who(c)} was ${ago(c.daysSince)} (${c.last.type}, ${fmt.date(c.last.date)})`;

  const intents = [
    { id: 'help', re: /^(hi|hey|hello|yo|help|what can you do|who are you)\b/,
      reply: (q, M) => ({ text: M.isDemo
        ? `Hey, I'm ${M.profile.firstName}'s twin, built from ${M.profile.firstName}'s (fictional) money, health, relationship and career data as of ${fmt.date(M.asOf)}. Ask me things like "how much did I spend on food", "am I sleeping enough", "who should I call this week" or "can I afford a $1,200 trip".`
        : `Hey ${M.profile.firstName}, I'm your twin. I answer from what you've logged on this device: ${M.finance.has.txCount} transactions, ${M.health.daily.length} check-ins, ${M.relationships.contacts.length} people and ${M.career.goals.length} goal${M.career.goals.length === 1 ? '' : 's'}. Ask "how much did I spend on food", "am I sleeping enough", "who should I call" or "can I afford a $300 jacket".` }) },

    { id: 'afford', re: /(afford|can i (buy|spend|book|get)|should i (buy|spend|book))/,
      reply: (q, M) => {
        const F = M.finance, amt = parseAmount(q);
        if (!amt) return { text: 'Tell me the amount and I\'ll run it, e.g. "can I afford a $1,200 trip?"', disclaimer: 'finance' };
        const cashFree = ok(F.checking) ? F.checking : F.accounts.filter((a) => a.type === 'savings' && !/emergency|trip/i.test(a.name)).reduce((s, a) => s + a.balance, 0);
        if (!ok(F.checking) && !cashFree && !ok(F.surplus3)) return { ...need('Add your checking balance and monthly income (Edit profile → Money) and I can run "can I afford it" checks.'), disclaimer: 'finance' };
        const buffer = M.isDemo ? 1500 : Math.min(1500, Math.max(300, Math.round((F.essentials || 1500) * 0.4))), spare = Math.max(0, cashFree - buffer), surplus = ok(F.surplus3) ? Math.max(0, F.surplus3) : 0;
        const isTrip = /(trip|travel|flight|vacation|japan)/i.test(q);
        const trip = F.tripFund;
        let verdict; const lines = [];
        lines.push(`${ok(F.checking) ? 'Checking' : 'Spare cash'}: ${fmt.usd(cashFree)} (keeping a ${fmt.usd(buffer)} cushion, so ${fmt.usd(spare)} is free)`);
        if (ok(F.surplus3)) lines.push(`${F.has.last ? 'Typical monthly leftover' : 'Projected leftover this month'} after bills, debt and auto-savings: ${F.surplus3 < 0 ? `${fmt.usd(F.surplus3)} (spending is on pace to beat income)` : fmt.usd(surplus)}`);
        if (isTrip && trip) lines.push(`${trip.name}: ${fmt.usd(trip.balance)}, but that's earmarked${/japan/i.test(trip.name) ? ' for Japan' : ''}`);
        if (ok(F.efund)) lines.push(`Emergency fund (${fmt.usd(F.efund)}) stays untouched${ok(F.efundMonths) ? `, since it only covers ${F.efundMonths.toFixed(1)} months` : ''}`.replace(/, since it only covers ([\d.]+) months/, (m, x) => (+x >= 6 ? `; it covers ${x} months` : m)));
        if (amt <= spare) verdict = `**Yes. ${fmt.usd(amt)} fits** from ${ok(F.checking) ? 'checking' : 'spare cash'} without touching savings. You'd have ${fmt.usd(cashFree - amt)} left${ok(F.checking) ? ' in checking' : ''}.`;
        else if (surplus > 0 && amt <= spare + surplus * 3) {
          const months = Math.ceil((amt - spare) / surplus);
          verdict = `**Not comfortably today.** ${fmt.usd(amt)} is ${fmt.usd(amt - spare)} more than the free cash. At your usual leftover of ${fmt.usd(surplus)}/mo, you can cover it in about **${months} month${months > 1 ? 's' : ''}**.`;
        } else verdict = `**Not right now.** ${fmt.usd(amt)} is more than about 3 months of leftover cash. Splitting it up or saving toward it first would be safer.`;
        if (isTrip && /Dining/.test(F.overBudget.map((b) => b.cat).join())) {
          const d = F.overBudget.find((b) => b.cat === 'Dining');
          lines.push(`Fastest lever: dining ran ${fmt.usd(d.actual - d.budget)} over budget in ${F.monthName(F.budgetMonth)}`);
        }
        return { text: verdict + '\n' + bullet(lines), disclaimer: 'finance' };
      } },

    { id: 'spend', re: /(spend|spent|spending|cost|paid|pay for|how much (did|do) i)/,
      reply: (q, M) => {
        if (/(weigh|sleep|steps|\blbs?\b|pounds)/.test(q)) return null;
        const F = M.finance;
        if (!F.has.tx && !F.transactions.length) return { ...need('Log a few transactions (Add → Transaction) or import a CSV from your bank.'), disclaimer: 'finance' };
        const match = CAT_WORDS.find(([re]) => re.test(q));
        const lastOnly = /last month|previous month/.test(q) || new RegExp(F.monthName(F.last).toLowerCase()).test(q), thisOnly = /this month|so far|mtd/.test(q) || new RegExp(F.monthName(F.cur).toLowerCase()).test(q);
        const cats = match ? match[1] : null, label = match ? match[2] : 'everything (excluding savings and debt payments)';
        const amt = (m) => (F.byMonthCat[m] ? (cats ? cats.reduce((s, c) => s + (F.byMonthCat[m][c] || 0), 0) : F.spend(m)) : 0);
        const mtd = (m) => cats ? cats.reduce((s, c) => s + F.mtd(m, c), 0) : F.mtd(m);
        const L = F.last, P = F.prev, cur = F.cur;
        const lines = [];
        if (!thisOnly && F.has.last) lines.push(`${F.monthName(L)}: **${fmt.usd(amt(L))}**${F.has.prev ? ` (${fmt.pct(E.util.pct(amt(L), amt(P)))} vs ${F.monthName(P)}'s ${fmt.usd(amt(P))})` : ''}`);
        if (!lastOnly || !F.has.last) lines.push(`${F.monthName(cur)} so far (1–${F.dayOfMonth}): **${fmt.usd(mtd(cur))}**${F.has.last ? `, vs ${fmt.usd(mtd(L))} by the same day last month` : ''}`);
        const B = F.has.last ? L : cur;
        if (cats) {
          const budget = cats.reduce((s, c) => s + (F.monthlyBudget[c] || 0), 0);
          if (budget) lines.push(`Monthly budget: ${fmt.usd(budget)}${amt(B) > budget ? `, so ${F.monthName(B)} ${F.has.last ? 'ran' : 'is already'} ${fmt.usd(amt(B) - budget)} over` : ''}`);
          if (cats.includes('Dining')) {
            const n = M.persona.finance.transactions.filter((t) => t.category === 'Dining' && t.date.startsWith(B)).length;
            if (n) lines.push(`${n} dining purchase${n > 1 ? 's' : ''} in ${F.monthName(B)}, about ${fmt.usd((F.byMonthCat[B].Dining || 0) / Math.max(1, n))} each`);
          }
        } else {
          const top = Object.entries(F.byMonthCat[B] || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${fmt.usd(v)}`).join(', ');
          if (top) lines.push(`Top categories in ${F.monthName(B)}${F.has.last ? '' : ' so far'}: ${top}`);
        }
        return { text: `Here's what you spent on ${label}:\n` + bullet(lines), disclaimer: 'finance' };
      } },

    { id: 'budget', re: /(budget|overspend|over spend|where.*money go)/,
      reply: (q, M) => {
        const F = M.finance;
        if (!F.budgetLast.length) return { ...need('Set monthly budgets for a few categories (Edit profile → Money) and log spending.'), disclaimer: 'finance' };
        const BM = F.monthName(F.budgetMonth) + (F.budgetPartial ? ' so far' : '');
        const over = F.overBudget.map((b) => `${b.cat}: ${fmt.usd(b.actual)} vs ${fmt.usd(b.budget)} budget (+${fmt.usd(b.actual - b.budget)})`);
        return { text: over.length ? `In ${BM} you went over in ${over.length} categor${over.length === 1 ? 'y' : 'ies'}:\n${bullet(over)}\nTotal spend was ${fmt.usd(F.spend(F.budgetMonth))}${F.income[F.budgetMonth] ? ` on ${fmt.usd(F.income[F.budgetMonth])} take-home` : ''}.`
          : `Every category ${F.budgetPartial ? 'is' : 'stayed'} within budget in ${BM}.`, disclaimer: 'finance' };
      } },

    { id: 'savings', re: /(sav(e|ing|ings)|net worth|emergency|retire|invest|wealth|how rich)/,
      reply: (q, M) => {
        const F = M.finance, g = F.goals[0];
        if (!F.has.accounts && !F.has.debts && !ok(F.rateNow)) return { ...need('Add your savings, investments and debts (Edit profile → Money) plus your monthly income.'), disclaimer: 'finance' };
        const inv = F.accounts.filter((a) => /retirement|investment/.test(a.type)).reduce((s, a) => s + a.balance, 0);
        return { text: `Net worth is **${fmt.usd(F.netWorth)}** (${fmt.usd(F.assets)} assets, ${fmt.usd(F.liabilities)} debt).\n` + bullet([
          F.rateBasis === 'last' ? `Savings rate: ${(F.lastSavingsRate * 100).toFixed(0)}% in ${F.monthName(F.last)}${ok(F.avgSavingsRate3) ? `, ${(F.avgSavingsRate3 * 100).toFixed(0)}% 3-month average` : ''}`
            : F.rateBasis === 'projected' ? `Savings rate: on pace for about ${(F.projRate * 100).toFixed(0)}% this month (projected)` : 'Savings rate: add income and spending to see it',
          ok(F.efund) ? `Emergency fund: ${fmt.usd(F.efund)}${ok(F.efundMonths) ? ` = ${F.efundMonths.toFixed(1)} months of essentials (goal ${M.persona.finance.emergencyFundTargetMonths || 6})` : ''}` : null,
          inv ? `Retirement + brokerage: ${fmt.usd(inv)}` : null,
          g && ok(g.monthsToGoal) ? `${g.name}: ${fmt.usd(g.saved)} of ${fmt.usd(g.target)}. At ${fmt.usd(g.monthly)}/mo that's ${g.monthsToGoal.toFixed(1)} months, and the deadline is in ${g.monthsLeft.toFixed(1)}${g.monthsToGoal > g.monthsLeft ? `, so bump it to about ${fmt.usd(g.neededMonthly)}/mo` : ''}` : null]), disclaimer: 'finance' };
      } },

    { id: 'debt', re: /(debt|loan|owe|credit card|interest|pay off)/,
      reply: (q, M) => {
        const F = M.finance, sorted = F.debts.slice().sort((a, b) => b.apr - a.apr);
        if (!sorted.length) return { text: 'You haven\'t added any debts. If you have a card balance or loan, add it in Edit profile → Money and I\'ll suggest which to pay first.', disclaimer: 'finance' };
        return { text: `Total debt: **${fmt.usd(F.liabilities)}**.\n` + bullet(sorted.map((d) => `${d.name}: ${fmt.usd(d.balance)} at ${d.apr}% APR`)) +
          `\nIf you have extra cash, it should go to the ${sorted[0].name.toLowerCase()} first, since it has the highest rate (${sorted[0].apr}%).`, disclaimer: 'finance' };
      } },

    { id: 'credit', re: /credit (score|rating)|fico/,
      reply: (q, M) => { const F = M.finance;
        if (!ok(F.creditNow)) return { ...need('Add your credit score in Edit profile → Money (optional). Update it monthly to see the trend.'), disclaimer: 'finance' };
        return { text: `Credit score is **${F.creditNow}**${F.credit.length > 1 ? `, ${F.creditNow >= F.credit12 ? 'up' : 'down'} ${Math.abs(F.creditNow - F.credit12)} points over ${F.credit.length >= 12 ? '12 months' : (F.credit.length - 1) + ' month(s)'}` : ''}.${F.cc ? ` Card utilization is ${(F.utilization * 100).toFixed(0)}% (${fmt.usd(F.cc.balance)} of ${fmt.usd(F.cc.limit)}), and getting under 10% usually helps.` : ''}`, disclaimer: 'finance' }; } },

    { id: 'sleep', re: /(sleep|tired|rest\b|insomnia|bed ?time)/,
      reply: (q, M) => { const H = M.health;
        if (!ok(H.sleep14)) return { ...need('Log your sleep in the daily check-in for a few days.'), disclaimer: 'health' };
        const enough = H.sleep14 >= 7; const phone = M.habits.list.find((h) => /phone|screen/i.test(h.name));
        return { text: `${enough ? '**Mostly yes.**' : '**Not really.**'} You averaged **${H.sleep14.toFixed(1)}h** over the last ${H.nights14} night${H.nights14 > 1 ? 's' : ''}${M.isDemo ? '' : ' logged'} (goal ${H.goals.sleepHours}h), and ${H.shortNights} of those nights were under 7h.\n` + bullet([
          ok(H.sleepPrev) ? `The month before averaged ${H.sleepPrev.toFixed(1)}h, so this is ${H.sleep14 < H.sleepPrev ? 'a recent dip' : 'steady'}` : null,
          ok(H.moodGoodSleep) ? `Mood is ${H.moodGoodSleep.toFixed(1)}/5 on 7h+ days vs ${H.moodBadSleep.toFixed(1)}/5 otherwise` : null,
          phone && ok(phone.rate14) ? `"${phone.name}" was done on only ${Math.round(phone.rate14 * phone.days)} of ${phone.days} nights. That's probably the easiest fix` : null]), disclaimer: 'health' }; } },

    { id: 'bp', re: /(blood pressure|\bbp\b|hypertens)/,
      reply: (q, M) => { const H = M.health;
        if (!ok(H.sys)) return { ...need('Add blood-pressure readings in the daily check-in (optional field), ideally a few mornings a week.'), disclaimer: 'health' };
        const rose = ok(H.sysOld) && H.sys - H.sysOld >= 2;
        const why = rose && ok(H.sleepPrev) && H.sleep14 < H.sleepPrev ? ` The rise lines up with less sleep${ok(H.workoutsPerWeekPrev) && H.workoutsPerWeek < H.workoutsPerWeekPrev ? ' and fewer workouts' : ''}.` : '';
        return { text: `Last 3 weeks average **${Math.round(H.sys)}/${Math.round(H.dia)}**, which is the ${H.bpCat.toLowerCase()} by American Heart Association categories.${ok(H.sysOld) ? ` Earlier readings averaged ${Math.round(H.sysOld)}/${Math.round(H.diaOld)} (${H.bpCatOld.toLowerCase()}).` : ''}${why} If it stays up, bring the log to a doctor.`, disclaimer: 'health' }; } },

    { id: 'weight', re: /(weight|weigh|bmi|lose|pounds|lbs?\b|kilos?|kg\b)/,
      reply: (q, M) => { const H = M.health, u = H.unit;
        if (!ok(H.wNow) && !H.wLatest) return { ...need('Add your weight in the daily check-in (optional).'), disclaimer: 'health' };
        const now = ok(H.wNow) ? H.wNow : H.wLatest.weightLb;
        const dl = H.wFirst ? H.wLatest.weightLb - H.wFirst.weightLb : 0;
        const trend = ok(H.w30) ? `, ${now - H.w30 <= 0 ? 'down' : 'up'} ${Math.abs(now - H.w30).toFixed(1)} ${u} vs a month ago` : H.wFirst && H.wFirst.date !== H.wLatest.date ? `. Latest ${H.wLatest.weightLb} ${u}, ${dl <= 0 ? 'down' : 'up'} ${Math.abs(dl).toFixed(1)} ${u} since ${fmt.date(H.wFirst.date)}` : '';
        return { text: `${ok(H.wNow) ? '7-day average' : 'Latest'} weight is **${now.toFixed(1)} ${u}**${trend}.${ok(H.goals.targetWeightLb) ? ` Goal is ${H.goals.targetWeightLb} ${u}, so ${Math.abs(now - H.goals.targetWeightLb).toFixed(1)} ${u} to go.` : ''}${ok(H.bmi) ? ` BMI is about ${H.bmi.toFixed(1)}, which is a rough measure that ignores muscle.` : ''}`, disclaimer: 'health' }; } },

    { id: 'exercise', re: /(workout|work out|exercis|gym|run(ning)?|steps|active|walk|train|fitness)/,
      reply: (q, M) => { const H = M.health;
        if (!ok(H.workoutsPerWeek) && !ok(H.steps7)) return { ...need('Log your steps in the daily check-in, or add a habit like "Work out 30 min".'), disclaimer: 'health' };
        const types = Object.entries(H.workoutTypes).sort((a, b) => b[1] - a[1]).map(([t, m]) => `${t} ${m} min`).join(', ');
        const lines = [ok(H.steps7) ? `Steps: ${fmt.num(Math.round(H.steps7))}/day this week${ok(H.steps30) && M.isDemo ? ` (30-day avg ${fmt.num(Math.round(H.steps30))})` : `, goal ${fmt.num(H.goals.steps)}`}` : null,
          types ? `Last 30 days by type: ${types}` : null, ok(H.rhr14) ? `Resting heart rate ${H.rhr14.toFixed(0)} bpm vs ${H.rhrPrev.toFixed(0)} the month before` : null];
        const head = ok(H.workoutsPerWeek) ? `Last 2 weeks: **${H.workouts14.length} workouts** (${H.workoutsPerWeek.toFixed(1)}/week vs goal ${H.goals.workoutsPerWeek}), down from ${H.workoutsPerWeekPrev.toFixed(1)}/week before.\n` : `You're averaging **${fmt.num(Math.round(H.steps7))} steps/day** this week.\n`;
        return { text: head + bullet(ok(H.workoutsPerWeek) ? lines : lines.slice(1)), disclaimer: 'health' }; } },

    { id: 'mood', re: /(mood|feel|stress|happy|sad|anxious|mental|energy)/,
      reply: (q, M) => { const H = M.health;
        if (!ok(H.mood14)) return { ...need('Rate your mood (1–5) in the daily check-in for a few days.'), disclaimer: 'health' };
        return { text: `Mood averaged **${H.mood14.toFixed(1)}/5** over the last 2 weeks${ok(H.moodPrev) ? ` vs ${H.moodPrev.toFixed(1)} before` : ''}${ok(H.stress14) ? `, and stress is ${H.stress14.toFixed(1)}/5` : ok(H.energy14) ? `, and energy is ${H.energy14.toFixed(1)}/5` : ''}.${ok(H.moodGoodSleep) ? ` The strongest pattern in the data is sleep: mood is ${(H.moodGoodSleep - H.moodBadSleep).toFixed(1)} points ${H.moodGoodSleep >= H.moodBadSleep ? 'higher' : 'lower'} on days with 7h+ sleep.` : ''} If low mood sticks around, talking to someone you trust or a professional is a good idea.`, disclaimer: 'health' }; } },

    { id: 'person', re: null,
      reply: (q, M) => {
        const R = M.relationships;
        const words = (x) => [x.name.split(' ')[0], x.relation].filter((w) => w && w.length >= 3).map((w) => w.toLowerCase().replace(/[^a-z0-9 ]/g, ''));
        const c = R.contacts.find((x) => words(x).some((w) => new RegExp('\\b' + w + '\\b').test(q))) ||
          R.contacts.find((x) => (/\b(mother|mum)\b/.test(q) && x.relation === 'Mom') || (/father/.test(q) && x.relation === 'Dad') || (/grandma/.test(q) && /Grand/.test(x.relation)));
        if (!c) return null;
        const ev = R.upcoming.find((e) => e.contact === c.name);
        const lead = ev && /(birthday|anniversary|when)/.test(q) ? `**${ev.label}: ${fmt.date(ev.date)}**, in ${fmt.days(ev.inDays)}.\n` : '';
        return { text: lead + `${lastContact(c)}. You aim for ${every(c.targetEveryDays)}, so ${c.overdue > 0 ? `you're **${c.overdue} days overdue**` : "you're on track"}.\n` +
          bullet([`${c.in30} check-in${c.in30 === 1 ? '' : 's'} in the last 30 days`, c.notes ? `Note: ${c.notes}` : null].concat(ev ? [`${ev.label}: ${fmt.date(ev.date)} (in ${fmt.days(ev.inDays)})`] : [])) };
      } },

    { id: 'who', re: /(who should i|call|text|reach out|catch up|neglect|haven'?t (talked|seen|called)|check in|lonely|friends?)/,
      reply: (q, M) => { const R = M.relationships;
        if (!R.contacts.length) return need('Add the people who matter to you (Add → Person) with how often you want to talk.');
        const list = R.overdue.slice(0, 4).map((c) => `**${c.name}** (${c.relation}): ${c.neverLogged ? 'no contact logged yet' : c.daysSince + ' days'}, aim is ${c.targetEveryDays}.${c.notes ? ' ' + c.notes : ''}`);
        const soon = R.upcoming.filter((e) => e.inDays <= 14).map((e) => `${e.label}: ${fmt.date(e.date)} (in ${fmt.days(e.inDays)})`);
        if (!list.length) return { text: `You're on track with everyone you track (${R.contacts.length} ${R.contacts.length === 1 ? 'person' : 'people'}).${soon.length ? `\n\nComing up:\n${bullet(soon)}` : ''}` };
        return { text: `This week I'd reach out to:\n${bullet(list)}${soon.length ? `\n\nComing up:\n${bullet(soon)}` : ''}` }; } },

    { id: 'dates', re: /(birthday|anniversary|upcoming|event|remember)/,
      reply: (q, M) => (M.relationships.upcoming.length ? { text: 'Upcoming dates:\n' + bullet(M.relationships.upcoming.slice(0, 5).map((e) => `${e.label}: ${fmt.date(e.date)} (in ${fmt.days(e.inDays)})`)) }
        : need('Add birthdays when you add people (Add → Person).')) },

    { id: 'career', re: /(career|promot|raise|salary|job|work|boss|review|meeting|focus)/,
      reply: (q, M) => { const C = M.career; const promo = C.goals.find((g) => /promot/i.test(g.name));
        if (!ok(C.salary)) {
          const cg = C.goals.filter((g) => g.area === 'career');
          return { text: `${M.profile.occupation ? `You're a ${M.profile.occupation}. ` : ''}I don't track salary or market pay in this version, so I can't benchmark a raise.` +
            (cg.length ? `\nCareer goals:\n${bullet(cg.map((g) => `${g.name}: ${g.progress}%${ok(g.daysLeft) ? `, ${g.daysLeft >= 0 ? `due in ${g.daysLeft} days` : `${-g.daysLeft} days past due`}` : ''}`))}` : '\nAdd a career goal (Add → Goal) and I\'ll track its pace.'), disclaimer: /raise|salary|pay/.test(q) ? 'finance' : null };
        }
        return { text: `You earn **${fmt.usd(C.salary)}**, ${Math.abs(C.gapPct).toFixed(0)}% ${C.gapPct > 0 ? 'below' : 'above'} the ${fmt.usd(C.marketRange.mid)} market midpoint (demo benchmark). The review is in ${fmt.days(C.daysToReview)}.\n` + bullet([
          promo ? `Promotion goal: ${promo.progress}% (${promo.done}/${promo.milestones.length} milestones). Next: ${promo.next ? promo.next.name : 'done'}` : null,
          ok(C.cagr) ? `Pay has grown ${C.cagr.toFixed(1)}%/yr since ${C.salaryHistory[0].year}` : null,
          ok(C.deepNow) ? `Deep work fell to ${C.deepNow.toFixed(1)}h/week while meetings rose to ${C.meetNow.toFixed(1)}h. Blocking 2 mornings a week would help` : null]), disclaimer: /raise|salary|pay/.test(q) ? 'finance' : null }; } },

    { id: 'goals', re: /(goal|habit|progress|japanese|jlpt|half marathon|on track)/,
      reply: (q, M) => {
        if (!M.career.goals.length && !M.habits.list.length) return need('Add a goal (Add → Goal) or a habit (Edit profile → Habits).');
        const g = M.career.goals.map((x) => `${x.name}: ${x.progress}% done${ok(x.daysLeft) ? (x.daysLeft >= 0 ? `, due in ${x.daysLeft} days` : `, ${-x.daysLeft} days past due`) : ''}${x.next ? `. Next: ${x.next.name}` : ''}`);
        const h = M.habits.list.map((x) => `${x.name}: ${ok(x.rate14) ? Math.round(x.rate14 * 100) + '%' : 'not started'}${x.streak ? ` (streak ${x.streak})` : ''}`);
        return { text: (g.length ? 'Goals:\n' + bullet(g) : 'No goals yet.') + (h.length ? '\n\nHabits (last 14 days):\n' + bullet(h) : '') };
      } },

    { id: 'category', re: new RegExp(CAT_WORDS.map(([re]) => re.source).join('|')),
      reply: (q, M) => intents.find((i) => i.id === 'spend').reply(q, M) },

    { id: 'overall', re: /(life score|how am i doing|overall|summary|summar|status|week|score)/,
      reply: (q, M) => { const S = M.scores; const brief = E.insights.overviewInsights(M).brief;
        const area = (k, n) => `${n} ${ok(S[k]) ? S[k] : '(needs data)'}`;
        if (!ok(S.life)) return { text: 'Your Life Score needs a bit more data. ' + bullet(brief.map((b) => b.text)) };
        const todo = brief.filter((b) => b.tone !== 'good');
        return { text: `Life Score is **${S.life}/100**: ${area('finance', 'finance')}, ${area('health', 'health')}, ${area('relationships', 'relationships')}, ${area('career', 'career')}.${M.areas < 4 ? ` (Based on ${M.areas} of 4 areas so far.)` : ''}\n${todo.length ? 'Top things to look at:\n' + bullet(todo.map((b) => b.text)) : 'Nothing urgent. Nice.'}` }; } },
  ];

  function localTwinReply(question, M) {
    const q = ' ' + question.toLowerCase().trim() + ' ';
    const qq = q.trim();
    for (const it of intents) {
      if (it.re && !it.re.test(it.id === 'help' ? qq : q)) continue;
      const r = it.reply(q, M);
      if (r) return { ...r, text: r.text.trim(), intent: it.id };
    }
    return { intent: 'fallback', text: `I can't answer that from ${M.isDemo ? 'my' : 'your'} data yet. ${M.isDemo ? 'In this demo I only know' : 'Without an AI model connected, I only know'} about money, health, relationships, career, goals and habits. Try one of the suggestions below.` };
  }

  function guessDisclaimer(q) {
    if (/(spend|money|afford|save|debt|invest|salary|budget|credit)/i.test(q)) return 'finance';
    if (/(sleep|weight|blood|health|workout|mood|stress)/i.test(q)) return 'health';
    return null;
  }

  E.twin = { askTwin, localTwinReply, buildTwinContext, listModels, loadWebLLM, webgpuStatus, PROVIDERS, WEBLLM_MODELS };
})();
