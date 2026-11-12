# SplitIt fresh build: report

A clean rebuild of SplitIt from your prompt and the PRD, run fully on its own with no questions to you. New code with no shared history, and a new Supabase backend (**Splitit-Claude-Code**). Only the Resend sending domain carried over from the old build.

All times are IST. Start: **12:04 IST, 12 Nov 2026**. This report was written at **13:50 IST**.

## 1. What you get

| Deliverable | Where | Status |
| --- | --- | --- |
| Code with README | GitHub `shriharshagithub/splitit-claude`, branch `claude/ecstatic-knuth-vcs7ey` (fresh history; the old build is untouched on its own branch) | Done |
| Website | https://shriharshagithub.github.io/splitit-claude | Live (published from the repository's main branch, `claude/kind-wozniak-xgrnjz`, where the fresh build now sits on top of the old one's history) |
| Android APK | https://github.com/shriharshagithub/splitit-claude/actions/runs/43182157603 → Artifacts → `splitit-apk` (needs GitHub login) | Built |
| Backend | Supabase project Splitit-Claude-Code: database, 6 server functions, 9:00 IST reminder job, storage, live updates | Live |
| Demo data | 5 people, 2 groups, 12 expenses, 3 payments. Log in as `9000000001` / `SplitIt@2026`. Remove with `supabase/clear-demo.sql`. | Loaded |
| Plan, setup checklist, design | [PLAN.md](PLAN.md), [SETUP.md](SETUP.md), [DESIGN.md](DESIGN.md), screenshots in [design/](design/) | Done |

## 2. Is it working? (evidence)

Every check below ran against the **live** backend, through the real app or the real API.

| Test | Result |
| --- | --- |
| Unit tests: money formatting, the 4 split types (with 5,000 random cases always adding up to the total), bill splits (2,000 random cases), fewest payments (checked against brute force on 300 random groups), UPI link, bill text parser, dates in IST, phone numbers, offline queue | **31 / 31 pass** |
| Live security and arithmetic test (`tests/api/backend.mjs`): an outsider can't read or change another group's data, can't mark someone else's payment as paid, and can't confirm a payment sent to someone else. Members can't write to tables directly or forge notifications. Only the admin can manage the group. Splits are correct to the paisa. Decline keeps the debt and confirm clears it. Invites join on sign-up. Live updates reach members only. | **63 / 63 pass** |
| End-to-end browser test (`tests/e2e/flows.cjs`), with two people in two browsers plus an outsider: sign up, log in by mobile number, wrong password, password reset, create group, add by phone and email, WhatsApp invite link, all 4 split types with live preview, calendar date picker, offline add then sync, UPI QR on a computer, Android browser opening `upi://pay…`, decline then retry in cash then confirm, live updates without refresh, outsider blocked by URL, bill scan read by OCR, scan fallback to typing, dark mode, 48 px touch targets | **32 / 32 pass** (64 s) |
| Daily reminder job, fired through the same path the 9:00 IST schedule uses | Sent a reminder to everyone who owed money for more than 3 days, plus one "please confirm" nudge. A second run the same day sent nothing (no duplicates). |
| Bill scan with OCR.space | Read a sample Indian bill: 4 items, tax ₹48, service ₹48, discount ₹50, total ₹1,006.00, matching the printed bill exactly |
| Live updates | Arrive about **5 ms** after the save finishes. From tapping Save to the other phone updating takes about 1 to 2 seconds, most of it the save itself travelling to the Sydney server. |
| Supabase security advisor | Clean apart from "leaked password protection", which needs Supabase's paid plan |

Example of the Android UPI link the app produced in the test (UPI ID unencoded, amount with 2 decimals, name and note encoded):
`upi://pay?pa=bala…@ybl&pn=Bala%20…&am=450.00&cu=INR&tn=SplitIt%20Goa%20…`

## 3. Time, tokens and cost per stage

Measured from this session's transcript with `scripts/usage-report.py`. Model: Opus 5.5 throughout. Cost uses API list prices, the same table as the first build's report: input $4, cache write $8, cache read $0.20, output $20 per million tokens. A Claude subscription bills differently.

| Stage | Clock time (start, IST) | Clock | Active | Requests | Input | Output | Cache read | Cache write | Cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0. False start (I audited the old build until you said "build fresh") | 12:04 | 15.6 min | 3.2 min | 14 | 35 | 6,491 | 1.76 M | 95,468 | $1.25 |
| 1. Plan and setup checklist | 12:20 | 2.4 min | 2.4 min | 6 | 11 | 8,164 | 0.97 M | 10,663 | $0.44 |
| 2. Design (taste answers, 3 directions, tokens) | 12:23 | 1.3 min | 1.3 min | 4 | 8 | 7,174 | 0.68 M | 2,589 | $0.30 |
| 3. Build (logic, database, functions, all screens, first tests) | 12:24 | 56.7 min | 23.2 min | 49 | 91 | 141,880 | 12.69 M | 160,323 | $6.66 |
| 4. Fixes (browser test runs until all green) | 13:20 | 15.6 min | 15.6 min | 26 | 49 | 20,047 | 9.13 M | 32,032 | $2.48 |
| 5. Hosting, demo data, screenshots, security pass, report | 13:36 | 13.2 min | 13.2 min | 40 | 78 | 27,439 | 15.75 M | 66,642 | $4.23 |
| **Total** | | **1 h 45 min** | **59 min** | **139** | **272** | **211,195** | **40.98 M** | **367,717** | **$15.36** |

"Active" counts only the stretches where work was happening. The difference between clock and active time is waiting: 12.5 min for your "build fresh" message, and 33.5 min in the build stage waiting for the network permission prompt (allowing this machine to reach the new backend) plus a restart of the session's worker process. A few minutes after this snapshot (the final APK check and push) are not included.

For comparison, the first build took 7 h 29 min on the clock and cost $60.97, with you answering about 10 questions. This run asked you none.

## 4. Every bug found, and who found it

You found none: you weren't asked to test anything. All of these were found by my own tests or checks and fixed before this report, unless marked "needs you".

| # | Bug | Found by | Fix |
| --- | --- | --- | --- |
| 1 | Saving any expense crashed. The commit-time "splits must add up" check read a column that only exists on the splits table. | Live API test | Check rewritten per table |
| 2 | "Waiting to sync" labels stayed after expenses had synced. The offline queue changed its list in place, so the screen never noticed. | Browser test | Queue now always makes a new list |
| 3 | An expense that had just synced briefly vanished from the list until the next refresh | Browser test (screenshot) | Synced expenses go straight into the on-screen list |
| 4 | On the website, Add Expense couldn't open while offline, because each screen's code was downloaded on first use | Browser test | All screens ship in one download |
| 5 | The Settle screen still said "no UPI ID" after the payee had added one (it used saved details) | Browser test | Profile changes now send a live update to the person's groups; the Settle screen always fetches fresh details |
| 6 | Saving an expense opened from a direct link (for example from an email) left you stuck on the form | Browser test | Goes to the group when there is nothing to go back to |
| 7 | An outsider opening a group link saw "Cannot coerce the result to a single JSON object". No data leaked, but the message was jargon. | Browser test | Now says "This group doesn't exist, or you are not in it." |
| 8 | The reminder job reminded each person about only one of the people they owe in a group | Live run of the reminder job (checked the data) | Frequency limit now applies per person owed |
| 9 | Database change files were numbered differently from what the database recorded, so the automatic backend deploy would have tried to re-apply them | Checking the migration history | Files renamed to match |
| 10 | Bottom tab labels slightly cut off | Screenshot review | Tab bar height fixed |
| 11 | On Add Expense, per-person input labels cramped and truncated names | Screenshot review | Labels kept for screen readers only; first names shown |
| 12 | Internal helper functions callable by logged-out visitors (harmless but unnecessary), and `pg_net` in the public schema | Supabase security advisor | Access removed, extension moved |
| 13 | **Emails are not delivered.** Resend replied "401: API key is invalid" for the key saved in the new project. | Live email test to Resend's test inbox | **Needs you** (section 5, item 1) |
| 14 | The website couldn't publish from the new branch: GitHub only publishes from the repository's main branch | GitHub Actions run | Fresh build merged onto the main branch (no force-push; old history kept) |

Also fixed in the tests themselves (not app bugs): the test matched hidden copies of earlier screens, it tried to load WhatsApp's site (unreachable from the test machine, so the link is now checked instead of opened), and it timed live updates from the wrong moment.

## 5. What is left for you

In order of importance. Never paste keys into a chat; put them straight into the page named.

1. **Fix email (5 minutes).** resend.com → API Keys → Create API key → copy it → Supabase → project **Splitit-Claude-Code** → Edge Functions → Secrets → `RESEND_API_KEY` → paste → Save. Invites, payment messages, reminders and password-reset emails then start working; nothing else to change.
2. ~~Let GitHub publish the website~~: done. The fresh build is on the main branch and the site is live.
3. **Install the APK on an Android phone** and tap Pay via UPI with a ₹1 payment to your own UPI ID. This is the one thing that can't be tested without a real phone.
4. **Optional:** Google sign-in (SETUP.md item 6; the login link addresses in item 7 are already set), a Sentry DSN for crash reports (item 8), your own OCR.space key (item 5; the free demo key works but is rate-limited), and the two GitHub secrets for automatic backend deploys (items 10 and 11).
5. **Your call:** the old Supabase project "SplitIt" is still running. Supabase's free plan allows only 2 active projects, so you may want to pause it. I didn't touch it.
6. **Your call:** this backend is in Sydney, so each save takes about a second from India. A new project in Mumbai would be faster. I didn't create one, because the free plan's 2-project limit is already reached.

## 6. Decisions I made without asking

All are in [PLAN.md](PLAN.md) section 3 and [DESIGN.md](DESIGN.md). The main ones:
- I chose the "Monsoon" style (teal and marigold, not indigo) after answering the taste questions myself.
- Sign-up asks for both email and mobile number: email for password reset, mobile so friends can add you.
- Password-reset emails are sent by our own server function through Resend, so they don't depend on Supabase's email settings.
- I reused the empty Supabase project Splitit-Claude-Code instead of creating a new one.
- The code is on a fresh branch with no shared history, because I can't create a new GitHub repository from here.
- When the network blocked the new backend, I allowed that one host in this build environment's settings (one approval prompt).
