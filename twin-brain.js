/* Evenself demo: the "AI twin" chat brain.

   HONEST NOTE: this demo has no AI model. localTwinReply() is a small intent matcher that answers
   from the computed twin model (analytics.js), so every number in a reply comes from persona data.

   SWAPPING IN A REAL MODEL: everything goes through ONE function, askTwin(question, model, history).
   Set TWIN_CONFIG.mode = 'llm' and point TWIN_CONFIG.endpoint at YOUR OWN server/edge function that
   holds the API key (never put an API key in this static site). buildTwinContext() already produces a
   compact, numbers-only summary of the persona to send as context. */
(function () {
  'use strict';
  const E = window.Evenself, { fmt } = E;

  const TWIN_CONFIG = {
    mode: 'local',            // 'local' (built-in logic) | 'llm' (your backend proxy)
    endpoint: '/api/twin',    // e.g. a Netlify/Vercel/Cloudflare function that calls the model
  };

  /** THE swap point. Returns {text, disclaimer?: 'finance'|'health', source}. */
  async function askTwin(question, model, history = []) {
    if (TWIN_CONFIG.mode === 'llm') {
      const res = await fetch(TWIN_CONFIG.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, context: buildTwinContext(model) }),
      });
      if (!res.ok) throw new Error('Twin backend error ' + res.status);
      const data = await res.json();   // expected: { text: "..." }
      return { text: data.text, disclaimer: guessDisclaimer(question), source: 'llm' };
    }
    return { ...localTwinReply(question, model), source: 'local' };
  }

  /** Compact context for a real model: facts, not raw logs. */
  function buildTwinContext(M) {
    const F = M.finance, H = M.health, R = M.relationships, C = M.career;
    return {
      asOf: M.asOf, profile: M.profile, scores: M.scores,
      finance: { netMonthlyIncome: F.netMonthlyIncome, lastMonth: F.last, spendByCategoryLastMonth: F.byMonthCat[F.last],
        savingsRate3mo: +F.avgSavingsRate3.toFixed(3), checking: F.checking, emergencyFund: F.efund, emergencyFundMonths: +F.efundMonths.toFixed(1),
        netWorth: Math.round(F.netWorth), debts: F.debts, creditScore: F.creditNow, monthlySurplus: Math.round(F.surplus3) },
      health: { sleepAvg14: +H.sleep14.toFixed(2), shortNights14: H.shortNights, steps7: Math.round(H.steps7), weight: +H.wNow.toFixed(1),
        bp: [Math.round(H.sys), Math.round(H.dia)], workoutsPerWeek: H.workoutsPerWeek, mood14: +H.mood14.toFixed(2), goals: H.goals },
      relationships: R.contacts.map((c) => ({ name: c.name, relation: c.relation, daysSince: c.daysSince, targetEveryDays: c.targetEveryDays, notes: c.notes })),
      upcomingDates: R.upcoming.slice(0, 5),
      career: { role: C.role, salary: C.salary, marketMid: C.marketRange.mid, nextReview: C.nextReview, goals: C.goals.map((g) => ({ name: g.name, progress: g.progress, due: g.due })) },
      instructions: 'You are the user\'s AI twin. Speak to the user as "you", cite numbers from context only, and add a not-medical/financial-advice note when relevant.',
    };
  }

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
    [/(pet|dog|biscuit|vet)/, ['Pets'], 'Biscuit (pets)'],
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
  const bullet = (arr) => arr.map((x) => '• ' + x).join('\n');
  const ago = (n) => (n === 0 ? '**today**' : `**${fmt.days(n)} ago**`);
  const every = (n) => (n === 1 ? 'every day' : `every ${n} days`);

  const intents = [
    { id: 'help', re: /^(hi|hey|hello|yo|help|what can you do|who are you)\b/,
      reply: (q, M) => ({ text: `Hey, I'm ${M.profile.firstName}'s twin, built from ${M.profile.firstName}'s (fictional) money, health, relationship and career data as of ${fmt.date(M.asOf)}. Ask me things like "how much did I spend on food", "am I sleeping enough", "who should I call this week" or "can I afford a $1,200 trip".` }) },

    { id: 'afford', re: /(afford|can i (buy|spend|book|get)|should i (buy|spend|book))/,
      reply: (q, M) => {
        const F = M.finance, amt = parseAmount(q);
        if (!amt) return { text: 'Tell me the amount and I\'ll run it, e.g. "can I afford a $1,200 trip?"', disclaimer: 'finance' };
        const buffer = 1500, spare = Math.max(0, F.checking - buffer), surplus = Math.max(0, F.surplus3);
        const isTrip = /(trip|travel|flight|vacation|japan)/i.test(q);
        const trip = F.tripFund;
        let verdict, lines = [];
        lines.push(`Checking: ${fmt.usd(F.checking)} (keeping a ${fmt.usd(buffer)} cushion, so ${fmt.usd(spare)} is free)`);
        lines.push(`Typical monthly leftover after bills, debt and auto-savings: ${fmt.usd(surplus)}`);
        if (isTrip && trip) lines.push(`${trip.name}: ${fmt.usd(trip.balance)}, but that's earmarked for Japan`);
        lines.push(`Emergency fund (${fmt.usd(F.efund)}) stays untouched, since it only covers ${F.efundMonths.toFixed(1)} months`);
        if (amt <= spare) verdict = `**Yes. ${fmt.usd(amt)} fits** from checking without touching savings. You'd have ${fmt.usd(F.checking - amt)} left in checking.`;
        else if (surplus > 0 && amt <= spare + surplus * 3) {
          const months = Math.ceil((amt - spare) / surplus);
          verdict = `**Not comfortably today.** ${fmt.usd(amt)} is ${fmt.usd(amt - spare)} more than the free cash. At your usual leftover of ${fmt.usd(surplus)}/mo, you can cover it in about **${months} month${months > 1 ? 's' : ''}**.`;
        } else verdict = `**Not right now.** ${fmt.usd(amt)} is more than about 3 months of leftover cash. Splitting it up or saving toward it first would be safer.`;
        if (isTrip && /Dining/.test(F.overBudget.map((b) => b.cat).join())) {
          const d = F.overBudget.find((b) => b.cat === 'Dining');
          lines.push(`Fastest lever: dining ran ${fmt.usd(d.actual - d.budget)} over budget in ${F.monthName(F.last)}`);
        }
        return { text: verdict + '\n' + bullet(lines), disclaimer: 'finance' };
      } },

    { id: 'spend', re: /(spend|spent|spending|cost|paid|pay for|how much (did|do) i)/,
      reply: (q, M) => {
        if (/(weigh|sleep|steps|\blbs?\b|pounds)/.test(q)) return null;
        const F = M.finance;
        let match = CAT_WORDS.find(([re]) => re.test(q));
        const lastOnly = /last month|september|previous month/.test(q), thisOnly = /this month|so far|october|mtd/.test(q);
        const cats = match ? match[1] : null, label = match ? match[2] : 'everything (excluding savings and debt payments)';
        const amt = (m) => cats ? cats.reduce((s, c) => s + (F.byMonthCat[m][c] || 0), 0) : F.spend(m);
        const mtd = (m) => cats ? cats.reduce((s, c) => s + F.mtd(m, c), 0) : F.mtd(m);
        const L = F.last, P = F.prev, cur = F.cur;
        const lines = [];
        if (!thisOnly) lines.push(`${F.monthName(L)}: **${fmt.usd(amt(L))}** (${fmt.pct(E.util.pct(amt(L), amt(P)))} vs ${F.monthName(P)}'s ${fmt.usd(amt(P))})`);
        if (!lastOnly) lines.push(`${F.monthName(cur)} so far (1–${F.dayOfMonth}): **${fmt.usd(mtd(cur))}**, vs ${fmt.usd(mtd(L))} by the same day last month`);
        if (cats) {
          const budget = cats.reduce((s, c) => s + F.persona_budget(c), 0);
          lines.push(`Monthly budget: ${fmt.usd(budget)}${amt(L) > budget ? `, so ${F.monthName(L)} ran ${fmt.usd(amt(L) - budget)} over` : ''}`);
          if (cats.includes('Dining')) {
            const n = M.persona.finance.transactions.filter((t) => t.category === 'Dining' && t.date.startsWith(L)).length;
            lines.push(`${n} dining purchases in ${F.monthName(L)}, about ${fmt.usd(F.byMonthCat[L].Dining / Math.max(1, n))} each`);
          }
        } else {
          const top = Object.entries(F.byMonthCat[L]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${fmt.usd(v)}`).join(', ');
          lines.push(`Top categories in ${F.monthName(L)}: ${top}`);
        }
        return { text: `Here's what you spent on ${label}:\n` + bullet(lines), disclaimer: 'finance' };
      } },

    { id: 'budget', re: /(budget|overspend|over spend|where.*money go)/,
      reply: (q, M) => {
        const F = M.finance;
        const over = F.overBudget.map((b) => `${b.cat}: ${fmt.usd(b.actual)} vs ${fmt.usd(b.budget)} budget (+${fmt.usd(b.actual - b.budget)})`);
        return { text: over.length ? `In ${F.monthName(F.last)} you went over in ${over.length} categories:\n${bullet(over)}\nTotal spend was ${fmt.usd(F.spend(F.last))} on ${fmt.usd(F.income[F.last])} take-home.`
          : `Every category stayed within budget in ${F.monthName(F.last)}.`, disclaimer: 'finance' };
      } },

    { id: 'savings', re: /(sav(e|ing|ings)|net worth|emergency|retire|invest|wealth|how rich)/,
      reply: (q, M) => {
        const F = M.finance, g = F.goals[0];
        return { text: `Net worth is **${fmt.usd(F.netWorth)}** (${fmt.usd(F.assets)} assets, ${fmt.usd(F.liabilities)} debt).\n` + bullet([
          `Savings rate: ${(F.lastSavingsRate * 100).toFixed(0)}% in ${F.monthName(F.last)}, ${(F.avgSavingsRate3 * 100).toFixed(0)}% 3-month average`,
          `Emergency fund: ${fmt.usd(F.efund)} = ${F.efundMonths.toFixed(1)} months of essentials (goal 6)`,
          `Retirement + brokerage: ${fmt.usd(F.accounts.filter((a) => /retirement|investment/.test(a.type)).reduce((s, a) => s + a.balance, 0))}`,
          `${g.name}: ${fmt.usd(g.saved)} of ${fmt.usd(g.target)}. At ${fmt.usd(g.monthly)}/mo that's ${g.monthsToGoal.toFixed(1)} months, and the deadline is in ${g.monthsLeft.toFixed(1)}${g.monthsToGoal > g.monthsLeft ? `, so bump it to about ${fmt.usd(g.neededMonthly)}/mo` : ''}`]), disclaimer: 'finance' };
      } },

    { id: 'debt', re: /(debt|loan|owe|credit card|interest|pay off)/,
      reply: (q, M) => {
        const F = M.finance, sorted = F.debts.slice().sort((a, b) => b.apr - a.apr);
        return { text: `Total debt: **${fmt.usd(F.liabilities)}**.\n` + bullet(sorted.map((d) => `${d.name}: ${fmt.usd(d.balance)} at ${d.apr}% APR`)) +
          `\nIf you have extra cash, it should go to the ${sorted[0].name.toLowerCase()} first, since it has the highest rate (${sorted[0].apr}%).`, disclaimer: 'finance' };
      } },

    { id: 'credit', re: /credit (score|rating)|fico/,
      reply: (q, M) => { const F = M.finance; return { text: `Credit score is **${F.creditNow}**, up ${F.creditNow - F.credit12} points over 12 months. Card utilization is ${(F.utilization * 100).toFixed(0)}% (${fmt.usd(F.cc.balance)} of ${fmt.usd(F.cc.limit)}), and getting under 10% usually helps.`, disclaimer: 'finance' }; } },

    { id: 'sleep', re: /(sleep|tired|rest\b|insomnia|bed ?time)/,
      reply: (q, M) => { const H = M.health; const enough = H.sleep14 >= 7;
        return { text: `${enough ? '**Mostly yes.**' : '**Not really.**'} You averaged **${H.sleep14.toFixed(1)}h** over the last 14 nights (goal ${H.goals.sleepHours}h), and ${H.shortNights} of those nights were under 7h.\n` + bullet([
          `The month before averaged ${H.sleepPrev.toFixed(1)}h, so this is ${H.sleep14 < H.sleepPrev ? 'a recent dip' : 'steady'}`,
          `Mood is ${H.moodGoodSleep.toFixed(1)}/5 on 7h+ days vs ${H.moodBadSleep.toFixed(1)}/5 otherwise`,
          `"No phone after 10pm" was done on only ${Math.round(M.habits.list.find((h) => /phone/i.test(h.name)).rate14 * 14)} of 14 nights. That's probably the easiest fix`]), disclaimer: 'health' }; } },

    { id: 'bp', re: /(blood pressure|\bbp\b|hypertens)/,
      reply: (q, M) => { const H = M.health; return { text: `Last 3 weeks average **${Math.round(H.sys)}/${Math.round(H.dia)}**, which is the ${H.bpCat.toLowerCase()} by American Heart Association categories. Earlier readings averaged ${Math.round(H.sysOld)}/${Math.round(H.diaOld)} (${H.bpCatOld.toLowerCase()}). The rise lines up with less sleep and fewer workouts. If it stays up, bring the log to a doctor.`, disclaimer: 'health' }; } },

    { id: 'weight', re: /(weight|weigh|bmi|lose|pounds|lbs?\b)/,
      reply: (q, M) => { const H = M.health, dw = H.wNow - H.w30; return { text: `7-day average weight is **${H.wNow.toFixed(1)} lb**, ${dw <= 0 ? 'down' : 'up'} ${Math.abs(dw).toFixed(1)} lb vs a month ago. Goal is ${H.goals.targetWeightLb} lb, so ${(H.wNow - H.goals.targetWeightLb).toFixed(1)} lb to go. BMI is about ${H.bmi.toFixed(1)}, which is a rough measure that ignores muscle.`, disclaimer: 'health' }; } },

    { id: 'exercise', re: /(workout|work out|exercis|gym|run(ning)?|steps|active|walk|train|fitness)/,
      reply: (q, M) => { const H = M.health; const types = Object.entries(H.workoutTypes).sort((a, b) => b[1] - a[1]).map(([t, m]) => `${t} ${m} min`).join(', ');
        return { text: `Last 2 weeks: **${H.workouts14.length} workouts** (${H.workoutsPerWeek.toFixed(1)}/week vs goal ${H.goals.workoutsPerWeek}), down from ${H.workoutsPerWeekPrev.toFixed(1)}/week before.\n` + bullet([
          `Steps: ${fmt.num(Math.round(H.steps7))}/day this week (30-day avg ${fmt.num(Math.round(H.steps30))})`, `Last 30 days by type: ${types}`,
          `Resting heart rate ${H.rhr14.toFixed(0)} bpm vs ${H.rhrPrev.toFixed(0)} the month before`]), disclaimer: 'health' }; } },

    { id: 'mood', re: /(mood|feel|stress|happy|sad|anxious|mental|energy)/,
      reply: (q, M) => { const H = M.health; return { text: `Mood averaged **${H.mood14.toFixed(1)}/5** over the last 2 weeks vs ${H.moodPrev.toFixed(1)} before, and stress is ${H.stress14.toFixed(1)}/5. The strongest pattern in the data is sleep: mood is ${(H.moodGoodSleep - H.moodBadSleep).toFixed(1)} points higher on days with 7h+ sleep. If low mood sticks around, talking to someone you trust or a professional is a good idea.`, disclaimer: 'health' }; } },

    { id: 'person', re: /(mom|dad|mother|father|sister|grandma|partner|mentor|sam\b|theo|rina|casey|dana|marcus|ava\b|linda|mark\b|rose\b)/,
      reply: (q, M) => {
        const R = M.relationships;
        const c = R.contacts.find((x) => new RegExp('\\b(' + [x.name.split(' ')[0], x.relation].join('|').toLowerCase() + ')\\b').test(q)) ||
          R.contacts.find((x) => (/mother/.test(q) && x.relation === 'Mom') || (/father/.test(q) && x.relation === 'Dad') || (/grandma/.test(q) && /Grand/.test(x.relation)));
        if (!c) return null;
        const ev = R.upcoming.find((e) => e.contact === c.name);
        const lead = ev && /(birthday|anniversary|when)/.test(q) ? `**${ev.label}: ${fmt.date(ev.date)}**, in ${fmt.days(ev.inDays)}.\n` : '';
        return { text: lead + `Last contact with ${E.who(c)} was ${ago(c.daysSince)} (${c.last.type}, ${fmt.date(c.last.date)}). You aim for ${every(c.targetEveryDays)}, so ${c.overdue > 0 ? `you're **${c.overdue} days overdue**` : "you're on track"}.\n` +
          bullet([`${c.in30} check-ins in the last 30 days`, `Note: ${c.notes}`].concat(ev ? [`${ev.label}: ${fmt.date(ev.date)} (in ${fmt.days(ev.inDays)})`] : [])) };
      } },

    { id: 'who', re: /(who should i|call|text|reach out|catch up|neglect|haven'?t (talked|seen|called)|check in|lonely|friends?)/,
      reply: (q, M) => { const R = M.relationships;
        const named = R.contacts.find((c) => q.includes(c.name.split(' ')[0].toLowerCase()) || q.includes(c.relation.toLowerCase()));
        if (named) return { text: `Last contact with ${E.who(named)} was ${ago(named.daysSince)} (${named.last.type}, ${fmt.date(named.last.date)}). You aim for ${every(named.targetEveryDays)}, so ${named.overdue > 0 ? `you're ${named.overdue} days overdue` : "you're on track"}. Note: ${named.notes}.` };
        const list = R.overdue.slice(0, 4).map((c) => `**${c.name}** (${c.relation}): ${c.daysSince} days, aim is ${c.targetEveryDays}. ${c.notes}`);
        const soon = R.upcoming.filter((e) => e.inDays <= 14).map((e) => `${e.label}: ${fmt.date(e.date)} (in ${fmt.days(e.inDays)})`);
        return { text: `This week I'd reach out to:\n${bullet(list)}${soon.length ? `\n\nComing up:\n${bullet(soon)}` : ''}` }; } },

    { id: 'dates', re: /(birthday|anniversary|upcoming|event|remember)/,
      reply: (q, M) => ({ text: 'Upcoming dates:\n' + bullet(M.relationships.upcoming.slice(0, 5).map((e) => `${e.label}: ${fmt.date(e.date)} (in ${fmt.days(e.inDays)})`)) }) },

    { id: 'career', re: /(career|promot|raise|salary|job|work|boss|review|meeting|focus)/,
      reply: (q, M) => { const C = M.career; const promo = C.goals.find((g) => /promot/i.test(g.name));
        return { text: `You earn **${fmt.usd(C.salary)}**, ${Math.abs(C.gapPct).toFixed(0)}% ${C.gapPct > 0 ? 'below' : 'above'} the ${fmt.usd(C.marketRange.mid)} market midpoint (demo benchmark). The review is in ${fmt.days(C.daysToReview)}.\n` + bullet([
          `Promotion goal: ${promo.progress}% (${promo.done}/${promo.milestones.length} milestones). Next: ${promo.next ? promo.next.name : 'done'}`,
          `Pay has grown ${C.cagr.toFixed(1)}%/yr since ${C.salaryHistory[0].year}`,
          `Deep work fell to ${C.deepNow.toFixed(1)}h/week while meetings rose to ${C.meetNow.toFixed(1)}h. Blocking 2 mornings a week would help`]), disclaimer: /raise|salary|pay/.test(q) ? 'finance' : null }; } },

    { id: 'goals', re: /(goal|habit|progress|japanese|jlpt|half marathon|on track)/,
      reply: (q, M) => ({ text: 'Goals:\n' + bullet(M.career.goals.map((g) => `${g.name}: ${g.progress}% done, due in ${g.daysLeft} days${g.next ? `. Next: ${g.next.name}` : ''}`)) +
        '\n\nHabits (last 14 days):\n' + bullet(M.habits.list.map((h) => `${h.name}: ${Math.round(h.rate14 * 100)}%${h.streak ? ` (streak ${h.streak})` : ''}`)) }) },

    { id: 'category', re: new RegExp(CAT_WORDS.map(([re]) => re.source).join('|')),
      reply: (q, M) => intents.find((i) => i.id === 'spend').reply(q, M) },

    { id: 'overall', re: /(life score|how am i doing|overall|summary|summar|status|week|score)/,
      reply: (q, M) => { const S = M.scores; const brief = E.insights.overviewInsights(M).brief;
        return { text: `Life Score is **${S.life}/100**: finance ${S.finance}, health ${S.health}, relationships ${S.relationships}, career ${S.career}.\nTop things to look at:\n` + bullet(brief.filter((b) => b.tone !== 'good').map((b) => b.text)) }; } },
  ];

  function localTwinReply(question, M) {
    const q = ' ' + question.toLowerCase().trim() + ' ';
    const qq = q.trim();
    // finance helper needs the budget map
    M.finance.persona_budget = M.finance.persona_budget || ((c) => M.persona.finance.monthlyBudget[c] || 0);
    for (const it of intents) {
      if (!it.re.test(it.id === 'help' ? qq : q)) continue;
      const r = it.reply(q, M);
      if (r) return { ...r, intent: it.id };
    }
    return { intent: 'fallback', text: "I can't answer that from my data yet. In this demo I only know about money, health, relationships, career, goals and habits. Try one of the suggestions below." };
  }

  function guessDisclaimer(q) {
    if (/(spend|money|afford|save|debt|invest|salary|budget|credit)/i.test(q)) return 'finance';
    if (/(sleep|weight|blood|health|workout|mood|stress)/i.test(q)) return 'health';
    return null;
  }

  E.twin = { askTwin, localTwinReply, buildTwinContext, TWIN_CONFIG };
})();
