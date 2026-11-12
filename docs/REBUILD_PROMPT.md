Build "SplitIt", a group expense-splitting app for India, end to end: plan, design, build, test, and host it. I am a non-technical founder. Treat me as the product owner, not as an engineer.

Attached: the product brief (PRD). Where this prompt and the PRD differ, this prompt wins.

## How to work with me

1. **Before anything else, give me one setup checklist** of every account and key you will need, in plain words: what it is for, the exact page to get it, which value to copy, and where to paste it. Never ask me to paste a secret key into this chat; tell me where to store it instead, and warn me about this before the first key.
2. **Plan, then stop.** Write the plan to `docs/PLAN.md` and wait for my approval before designing.
3. **Ask me about taste before designing.** Ask 3 to 5 questions (apps I like, colours, mood, logo) and show me 2 or 3 style directions. Only design the full screens after I pick one.
4. **Build in small pieces and test each one** the way a user would (through the real app and API, in a real browser), before moving on.
5. **When something breaks, check the logs and the data first,** then tell me the cause with the evidence. Do not guess.
6. **Ask before anything irreversible** (deleting data or accounts, changing live settings). Make all other technical choices yourself and note them in the plan.
7. All times I see in IST. Explain everything in plain language.

## Product

Friends in a group add shared expenses. The app works out who owes whom in the fewest payments, and people settle up over UPI. The app never holds or moves money.

- **Accounts:** sign up and log in with email or Indian mobile number plus password, and "Continue with Google". Password reset by email.
- **Groups:** create a group (Trip, Flat, Other) and add people by phone or email. If they are not on SplitIt, create an invite that joins them to the group when they sign up. Send email invites automatically. Every group also has a shareable invite link that the admin can reset. Phone invites get a **"Send on WhatsApp"** button (a `wa.me` link with the message and link filled in). Send an "added to group" email to existing users.
- **Expenses:** amount, description, category, date (a calendar picker with Today and Yesterday; show dates as "3 Nov 2026" in local IST time), who paid, and four split types: equal, exact amounts, percentages, shares. Show a live preview. Any leftover paise go to the payer.
- **Scan a bill:** take or choose a photo, shrink it under 1 MB, read it with **OCR.space** (free tier), parse items, tax, service charge, discount and total. Let people assign items to members, and share tax and service charge in proportion. If reading fails, open the same screen empty for manual entry.
- **Balances:** per group and overall, in words ("you owe ₹450.00"). Show "who pays whom" with the minimum number of payments (exact search for up to 16 people with a balance, greedy beyond that).
- **Settle up over UPI, peer to peer, no payment gateway:**
  - Build a standard `upi://pay?pa=&pn=&am=&cu=INR&tn=` link: UPI ID left unencoded, amount in rupees with two decimals, name and note encoded.
  - On Android (app and browser), open the link so the phone shows its UPI apps. Declare the `upi` scheme in Android's `<queries>` so Android 11+ can find them.
  - On iPhone and computers, show the link as a QR code plus the UPI ID with a Copy button.
  - After paying, ask "Did the payment go through?" and take an optional UPI reference. Then the receiver confirms or declines. Only the receiver's confirmation clears the debt.
  - Cash settlement works the same way.
  - Prompt anyone who is owed money to add their UPI ID.
- **Notifications:** in-app and by email for payment requests, "marked as paid", confirmations and invites. A daily 9:00 IST reminder for debts older than 3 days, and a nudge to receivers who have not answered a payment claim within 3 days. Each person can set reminders to daily, weekly or off.
- **Live updates:** when anyone in a group adds an expense or settles, every open screen updates by itself within a second, with no manual refresh.
- **Offline:** groups, expenses and balances stay readable offline. Expenses added offline are queued, survive closing the app, and sync on reconnect.
- **Profile:** name, phone, email, photo, UPI ID, reminder setting, log out.

## Technology (decided; free plans only)

- **App:** React Native with Expo and Expo Router, in TypeScript. One codebase for Android, iPhone and the web.
- **Backend:** Supabase on the free plan:
  - Postgres with row-level security on every table.
  - Every write through a checked `security definer` function.
  - Auth, Storage (private bucket for bills, public bucket for avatars), and Edge Functions.
  - pg_cron and pg_net with a Vault secret for scheduled jobs and email triggers.
  - Realtime for live updates.
- **Email:** Resend, from my verified domain. Make the sender address setting tolerant of formatting.
- **Bill reading:** OCR.space. **Crash reports:** Sentry.
- **Hosting:**
  - GitHub Actions run checks on every push.
  - An Android APK is built and attached to each run.
  - The website is published on GitHub Pages, so any phone can use it, including iPhone without Xcode.
  - A backend deploy workflow updates Supabase.
- **Money** is integer paise everywhere. The database is the source of truth, and a commit-time check rejects any expense whose splits do not add up to the total.

## Quality bar

- Unit tests for money, splits, fewest payments, the UPI link and bill parsing, including random tests that splits always sum to the total.
- Database security tests proving nobody can read or change another group's data, mark someone else's payment as paid, or confirm a payment sent to someone else.
- An end-to-end browser test of the main flows against the live backend.
- Accessible: 48 px touch targets, light and dark mode, and money direction written in words, never colour alone.

## Deliverables

1. Live website link, Android APK, and code in my GitHub with a README.
2. Demo data I can clear.
3. A plain-language report:
   - time taken (clock and active) per stage: plan, design, build, fixes;
   - tokens (input, output, cache read, cache write) and cost per stage;
   - every bug found, and who found it;
   - what is left for me to do.
