# Evenself: your AI twin

Evenself puts your money, health, relationships, goals and habits in one dashboard. It gives you a Life Score and a "twin" you can ask things like "can I afford this?" or "who should I call this week?".

There are two modes, and the header switch moves between them:
- **Demo:** Jordan Ellis, 31, a fictional persona with 6 months of generated data. Nothing about Jordan is real.
- **My data:** each visitor enters their own numbers in a 6-step wizard (every step can be skipped), then keeps them current with quick-add forms or a bank CSV.

> Not medical, financial or legal advice. Evenself summarizes what's entered; it can't know what isn't.

## Privacy model
- **This is a static site.** There is no backend, no accounts, no analytics and no trackers.
- **Data lives only in the visitor's browser.** It is stored in `localStorage` under `evenself-user-v1` and is never uploaded.
- **The page enforces this with a Content-Security-Policy.** The browser may only connect to this site itself, plus the optional AI endpoints below, and only when the visitor turns them on.
- **Visitors control their data:**
  - Data & Privacy → **Download my data (JSON)** and **Import backup**.
  - **Delete all my data** asks you to type DELETE. It wipes every Evenself key and any downloaded on-device model.
- **The limits are stated in the app.** There is no sync between devices or browsers. Clearing site data erases everything. Anyone using the same browser profile can see the data.

## Features (v2)
- **Welcome screen** with "Try the demo" or "Create my twin".
- **Onboarding wizard** (mobile full-screen sheets):
  - Profile.
  - Money: take-home pay, recurring bills, accounts and investments, debts with APR, minimum payment and card limit, an optional credit score, and optional budgets.
  - Health: sleep and steps goals, weight unit, goal and height, optional blood-pressure tracking.
  - People: relation, how often you want to talk, birthday, and when you last talked.
  - Goals: area, target date and progress.
  - Habits.
- **Quick add** (the **+ Add** button or the overview shortcuts):
  - **Transactions**, auto-categorized by keywords (e.g. "Chipotle" → Dining). Edit and delete are available.
  - **Daily check-in:** sleep, steps, mood, energy, weight, optional BP and habits. Entries are keyed by date, so re-saving a day edits it.
  - **Log contact.**
  - **Goal progress.**
  - **CSV import:**
    - Column mapping is guessed, then editable.
    - Supports a single amount column (either sign convention) or separate debit/credit columns.
    - Dates can be US `MM/DD/YYYY` or ISO.
    - Keyword auto-categorization, a preview, and duplicate skipping.
    - Optional "file already includes my bills".
- **One data pipeline.** User data → `store.toInput()` → the same `analytics.buildModel()` the demo uses → insights, charts, Life Score and chat.
  - Recurring bills and debt minimums are counted automatically each month (this can be switched off).
  - Missing areas show **"add X to unlock"** empty states instead of NaN.
  - The Life Score is averaged over the areas that have data.
- **Data & Privacy tab:**
  - All entries, with search, edit and delete.
  - Backup and restore, and delete-all.
  - AI chat settings and the privacy explainer.
- **Unchanged from v1:** the demo (identical numbers and chat answers), the design, dark and light themes, mobile layout, and disclaimers.

## AI chat options (all optional, all free)
The twin always works without AI. **Built-in logic** answers about 25 kinds of questions from your numbers, and nothing is sent anywhere. In Data & Privacy → AI chat, a visitor can also choose one of these:

| Option | What leaves the browser | Notes |
|---|---|---|
| **Google Gemini, your own free key** (aistudio.google.com/apikey) | The question and a compact summary of computed stats go **directly to Google**. Raw entries are sent only if the visitor ticks the opt-in. | The free tier needs no card. Google may use free-tier prompts to improve its products, and this is stated in the UI. Calls go to `generativelanguage.googleapis.com` with the `x-goog-api-key` header (browser CORS works). |
| **Groq, your own free key** (console.groq.com/keys) | Same as Gemini, sent **directly to Groq**. | Has a free tier and supports browser CORS. Uses `openai/gpt-oss-20b` by default; the model list is pulled from the visitor's key. |
| **On-device model (WebLLM)** | Nothing. The model runs on the visitor's GPU. | A one-time download of about 200 MB to 2.3 GB from Hugging Face, cached by the browser. Needs WebGPU (recent Chrome or Edge on desktop; mobile support varies). The library is loaded from jsDelivr only when this option is chosen. |

- **Keys:** the site ships no key. A visitor's key is stored only in their `localStorage`, sent only to that provider, and removable with **Remove key**. "Save & test" checks the key by listing models.
- **Fallback:** if an AI call fails (bad key, rate limit, offline), the twin falls back to the built-in answer and says why.

## Structure
Flat build for GitHub Pages: every file sits at the root. The source with folders, tests and tools lives in `ai-twin-demo/`.

## Run
```bash
python3 -m http.server 8000   # open http://localhost:8000
```
Opening `index.html` straight from disk (file://) also works.

## Known limits
- **Storage:** no sync between devices. If browser storage is cleared, the data is gone unless the visitor downloaded a backup. Data is not encrypted at rest; anyone with access to the browser profile can read it.
- **Formats:** amounts are USD only. CSV dates assume US month/day order when ambiguous.
- **Benchmarks and charts:** there is no salary or market benchmark for real users. The career radar and salary charts are demo-only.
- **Free AI tiers:** these have rate limits, and the free model names change over time (the model list is fetched live).
- **Gemini free tier:** Google may use prompts to improve its products.
- **WebLLM:** needs WebGPU and a large download. Small models give weaker answers.
