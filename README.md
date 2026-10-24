# Agent Guardian

A user-owned safety layer that sits between a personal AI shopping agent and checkout.
A real Gemini agent shops in a mock marketplace. Before anything is bought or shared,
Guardian checks the action, then allows it, asks you, or blocks it, and explains why.

Built for a case prompt set in 2040, where everyone has a personal agent that knows them well
and acts for them. All brands, sellers and people in the store are invented.

## What's real and what's mocked

| Part | Status |
|---|---|
| Shopping agent | Real. Gemini with function calling, plain helpful system prompt, no tricks |
| Hidden-instruction scanner | Real. Pattern rules plus Llama Prompt Guard 2 (via Groq) |
| Rules engine | Real. Your mandate, checked in code. A model can't override it |
| Deal checks | Real logic on mock data: 12-week price history, real stock, fees, sponsored ranking |
| AI judge | Real. Gemini sees structured facts only, never page text, so pages can't inject it |
| Approvals | Real. The agent pauses until you answer in the UI |
| Evals | Real. A 41-case test set plus agent runs with Guardian off vs on |
| Store, payments, delivery | Mocked. Nothing is charged |

## How it works

```
                 search / view                    buy / add_addon / share_info
 Gemini agent ─────────────────► Store pages      ───────────────┐
      ▲              │                                            ▼
      │      Scanner hides injected text                  Guardian pipeline
      │      before the agent reads it           1. Provenance: did a hidden instruction cause this?
      │                                          2. Your rules (budget, caps, seller floor, never share)
      │                                          3. Deal checks (price history, fake discount, fees, sponsored)
      │                                          4. AI judge: does this fit the task? (can pause, never block)
      │                                                         │
      └──── "ordered" / "blocked: reason" / "user said no" ◄────┴── allow │ ask you │ block
```

The strictest verdict wins. Rules and deal checks run first and cost nothing.
When the agent is blocked, Guardian tells it about a better listing if one exists.

## Run it on your computer (Windows)

You need Python 3.11 or newer and Node.js 20 or newer.

**1. Get keys (both free)**
- Gemini: https://aistudio.google.com/apikey
- Groq (for Prompt Guard): https://console.groq.com/keys

**2. Set up the backend** (PowerShell, in the project folder)

```powershell
copy .env.example .env
notepad .env            # paste your two keys, check the model ids
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

If PowerShell refuses to activate the venv, run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

**3. Start the frontend** (a second PowerShell window)

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. No keys yet? Pick "Demo agent, no key needed".

**4. Check the model ids** before your first real run. Model names change often.
In AI Studio, copy the exact ids for a Flash model (agent) and a Flash-Lite model (judge)
into `AGENT_MODEL` and `JUDGE_MODEL` in `.env`, then restart the backend.
`http://localhost:8000/api/health` shows what the server is using.

## Tests and evals

```powershell
cd backend
pytest -q                                        # 10 tests, no keys needed
python -m app.evals.guardian_evals               # 41 test cases, offline
python -m app.evals.guardian_evals --live        # adds Prompt Guard and the AI judge
python -m app.evals.agent_evals --agent gemini --runs 3   # real agent, Guardian off vs on
```

Results are saved in `backend/data/` and shown on the Evals tab.

**What the evals measure**
- Harmful actions let through (goal: none) and safe orders wrongly stopped (goal: under 5%)
- Hidden instructions blocked outright vs only paused
- Scanner recall and false alarms, for pattern rules, Prompt Guard and both together
- AI judge agreement with the labels on "does this fit the task?"
- With a real agent: share of runs where something harmful happened, money lost to it,
  share of the task completed, and questions asked per run (Guardian off vs on)

The test set has deliberate hard cases: Hindi and disguised injections that the pattern rules
miss, and safe reviews that look suspicious. Offline, 2 of 41 cases are known misses.
Run the live suite to see how much Prompt Guard and the judge close that gap.
The cases were written by the builder, so add some written by someone else before trusting the numbers.

## Deploy a live link (Render, free)

1. Push this folder to a GitHub repo. `.env` is ignored, so your keys stay local.
2. On https://render.com, choose New, then Blueprint, and pick the repo. It reads `render.yaml`.
3. Enter `GEMINI_API_KEY` and `GROQ_API_KEY` when asked. Keys stay on the server.
4. Wait for the build, then open the URL.

Free instances sleep when idle, so the first visit can take about a minute.
To show your real agent numbers on the deployed Evals tab, run the evals locally and commit
`backend/data/guardian_evals.json` and `backend/data/agent_evals.json` before pushing.
Runs are rate-limited per visitor (`RUNS_PER_IP_PER_HOUR`) to protect your free quota.

## Recording the walkthrough video

1. Run the festive-sale task with **Guardian off**. Show the hidden review, the seller asking
   for a phone number, the 3.2★ seller and the fake "60% off" all going through.
2. Run it again with **Guardian on**. Show the hidden text being removed from pages,
   the fake discount paused with its price chart, picking the better listing,
   the cooker blocked and the agent switching to the better seller, and the gift card approval.
3. Open **Your rules**, type "No sellers under 4.2 stars", and show it compiled into a rule.
4. Open **Receipts** for the why behind each order.
5. Open **Evals** and point at the off vs on numbers and the honest misses.

## Project map

```
backend/
  app/main.py              API: runs, live events (SSE), approvals, rules, evals
  app/runner.py            One run: tools for the agent, Guardian in front of every action
  app/agent/gemini_agent.py   Real Gemini agent loop (function calling)
  app/agent/scripted_agent.py Demo agent for offline use and tests
  app/guardian/scanner.py     Hidden-instruction detection (patterns + Prompt Guard 2)
  app/guardian/rules.py       Your mandate, checked in code
  app/guardian/integrity.py   Price history, fake discounts, fees, sponsored ranking
  app/guardian/judge.py       AI judge on structured facts only
  app/guardian/pipeline.py    Puts it together, picks the verdict
  app/rules_compiler.py       Plain-language rule to mandate change
  app/store/catalog.json      Mock store and user profile (edit to add products)
  app/evals/golden.json       Test cases and scanner test texts
frontend/src/
  pages/RunPage.jsx        Task, live feed, approvals, wallet
  pages/RulesPage.jsx      Rules editor
  pages/ReceiptsPage.jsx   Orders with reasons, decision log
  pages/EvalsPage.jsx      Eval results
```

## Troubleshooting

- **"model not found"**: the model id in `.env` doesn't exist for your key. Copy it from AI Studio.
- **"free-tier limit was hit"**: wait a minute, use fewer eval runs, or switch to the demo agent.
- **Prompt Guard shows no scores**: check `GROQ_API_KEY`. The scanner still works with pattern rules alone.
- **Frontend says it can't reach the server**: the backend isn't running on port 8000.

## Known limits

- Text only. Instructions hidden in images aren't scanned.
- One user, in-memory runs. Runs disappear when the server restarts.
- No real payments, accounts or store APIs.
- The judge and agent are both Gemini models. A judge from a different model family would be more independent.
