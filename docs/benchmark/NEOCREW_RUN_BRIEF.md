# NeoCrew run brief: SplitIt benchmark

Build SplitIt on NeoCrew and record the run so it can be compared with the five competitor runs (Emergent, Replit, Bolt, Lovable, Base44) from Sep 2026.

## Inputs

- Spec: [docs/PRD.md](../PRD.md). Paste it into NeoCrew unchanged.
- Scorecard (65 checks, 100 points): https://docs.google.com/spreadsheets/d/1rQVaRVq03l41Ui3m2ji0CBlxJD-gBqIh2aF3bCtf3-8 (columns "NeoCrew" and "NeoCrew run 2").
- Run log (one tab per tool): https://docs.google.com/spreadsheets/d/1SUXZiAjw18e2ZHHfeWnBe-NKlErE-J0tmaT18F1HEgk
- Payments: Razorpay and Stripe test mode, the same keys used for every other tool.
- NeoCrew: the browser where the owner is already signed in.

## Two runs

**Run 1: same method as the competitors (the fair score).**
Paste the PRD. Answer NeoCrew's questions as a non-technical founder would. Accept its defaults. Do not give technical hints or debug for it. Report bugs in plain language, the way a founder would ("login fails on my phone"), not with stack traces. Stop when it holds up on a phone or progress stalls for 2 hours.

**Run 2: best effort.**
Start fresh. Explore 2 to 3 design directions and pick the strongest, with a short reason. Push the build as far as good judgement allows. Technical guidance is allowed and every instance is logged.

## Rules

- No questions to the owner during the build. Make the call, note it, move on.
- Stuck for 30 minutes: try a different route (rephrase, roll back, split the task, start a fresh thread) and log it.
- Stop and ask only before: paying or topping up credits, changing account settings, publishing to an app store.
- Never type passwords or card details.
- The owner tests on a physical phone. Hand over a build link or QR code at each milestone and record what they report.

## Log for each run

| Metric | How |
| --- | --- |
| Time to first thing you can look at | minutes from first prompt |
| Time to working | active minutes until it holds up on a phone |
| Prompts used | count every message sent |
| Credits used, and the INR a customer would pay | from NeoCrew's usage screen |
| Time to deploy | minutes |
| Blocking failures | count, each with symptom, cause and fix |
| Installable mobile app | yes / no, and how |
| Human approval gates | each one, and what was decided |
| Reminders, offline, bill-scan OCR | built / partly / not built (no competitor finished these) |

Then score both runs against the scorecard, sections A to K, and export the code to GitHub so the security (J) and production (K) sections can be scored the same way for all six tools.

## Output

`docs/benchmark/NEOCREW_RUN.md` with the metrics table, the failure log, screenshots, and a one-paragraph verdict in the same style as the competitor posts in the NeoCrew Benchmark channel.
