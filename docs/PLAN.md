# SplitIt: build plan (fresh build, 12 Nov 2026)

Inputs: the owner's prompt (wins where it differs) and [PRD.md](PRD.md). This is a clean build: new code, new history, new Supabase project (**Splitit-Claude-Code**, `ohawfftzgjuqwbilovmy`). Only the Resend key and verified sending domain carry over.

The owner asked for a fully autonomous run with no questions. Every decision the prompt says to ask about (approval, taste, irreversible steps) was taken by me and is written down here and in [DESIGN.md](DESIGN.md).

## 1. How it works, in plain words

- People sign up with an email or an Indian mobile number and a password (or Google). They create a group and add friends by phone or email. Friends who aren't on SplitIt get an invite that adds them to the group when they sign up.
- Anyone in a group adds an expense: who paid, how much, and how to split it. The database works out each person's share in paise (1/100 rupee), gives any leftover paise to the payer, and refuses to save an expense whose shares don't add up to the total.
- SplitIt adds up what each person paid and owes, then works out the fewest payments that clear everyone.
- To settle, the person who owes pays the other person directly in their own UPI app (or in cash) and taps "I've paid". The money only counts once the receiver taps "Confirm".
- Emails and in-app messages tell people about invites, payment requests, payment claims and confirmations. A daily 9:00 IST job sends reminders.
- Every open screen updates by itself when anyone in the group changes something. The app keeps working offline for reading and for adding expenses.

## 2. Technology

| Part | Choice |
| --- | --- |
| App | Expo (React Native) + Expo Router, TypeScript. One codebase for Android, iPhone and web |
| Data in the app | TanStack Query, cached to device storage so it is readable offline |
| Offline writes | An outbox in device storage. Each expense gets its ID on the phone, so a retry can never create a duplicate |
| Database | Supabase Postgres, Mumbai-region alternative not available on this project (it is in Sydney, `ap-southeast-2`); fine for testing |
| Security | Row-level security on every table (people only see their own groups). Apps can only read tables; every change goes through a `security definer` function that checks who is calling |
| Server code | Supabase Edge Functions: `auth-signup`, `auth-login`, `scan-bill`, `send-email`, `reminders` |
| Scheduled jobs and email hooks | pg_cron + pg_net, authenticated by a shared secret kept in Supabase Vault |
| Live updates | Supabase Realtime (database changes, filtered by the same security rules) |
| Email | Resend from `thewowlabzteam.site` |
| Bill reading | OCR.space free tier (falls back to its public demo key until the owner adds one) |
| Crash reports | Sentry (app and server), switched on when a DSN is added |
| Hosting | GitHub Pages (web), GitHub Actions (checks, APK, web deploy, backend deploy) |

## 3. Decisions I made without asking

1. **Money**: integer paise everywhere (`bigint` in the database). Rupees only appear on screen and in the UPI link.
2. **Splits**: the database (`compute_splits`) is the source of truth; the app runs the same rules for the live preview. Leftover paise go to the payer; if the payer isn't in the split, to the first person in it. A deferred constraint trigger re-checks the total when the transaction commits.
3. **Fewest payments**: exact for up to 16 people with a non-zero balance (find the largest number of groups whose balances cancel out; payments = people − groups), greedy (largest debtor pays largest creditor) beyond 16.
4. **Phone login without SMS**: Supabase's own phone login needs a paid SMS provider. Sign-up and log-in go through two small server functions. Phone numbers are therefore not verified by OTP; this is noted as a limit.
5. **Email confirmation on sign-up is off** so testers can get in straight away. Password reset uses Supabase's single-use, time-limited links.
6. **Invites**: a phone or email that isn't on SplitIt becomes an invite row. Sign-up claims every invite matching the new account's phone or email. Each group also has an invite link (`/join/<code>`) that admins can reset.
7. **Emails are triggered by the database**: inserting a notification fires a pg_net call to `send-email`, so no screen can forget to send one.
8. **Reminders** run at 03:30 UTC (09:00 IST). They go to anyone who has owed money in a group for more than 3 days, following their daily, weekly or off setting, plus one nudge to receivers who haven't answered a payment claim for 3 days.
9. **UPI**: on Android (app or browser) the `upi://pay` link opens the system chooser; the Android manifest declares the `upi` scheme in `<queries>`. On iPhone and computers we show a QR code and the UPI ID with Copy.
10. **Date picker**: one calendar component of our own, the same on every platform, with Today and Yesterday shortcuts. Dates are stored as calendar dates and shown as "3 Nov 2026".
11. **Design**: I picked the style direction myself; see [DESIGN.md](DESIGN.md).
12. **Repository**: I can't create a new GitHub repository from this environment, so the fresh build lives in `shriharshagithub/splitit-claude` on branch `claude/ecstatic-knuth-vcs7ey` with **no shared history** with the old build (which stays on `main`). It can be pushed to a new repository as is.
13. **Reversible only**: I didn't touch the old Supabase project or delete anything outside the new, empty project.

## 4. Build order (each piece is tested before the next)

1. Core logic with unit tests: money, splits, fewest payments, UPI link, bill text parser, dates.
2. Database: tables, security rules, write functions, Realtime, Storage buckets. Security tests run through the real API as real users.
3. Server functions: sign-up, log-in, email, bill scan, reminders. Tested with real calls.
4. App screens: sign-in, home, group, add expense, scan, settle, activity, profile, invite.
5. Live updates and offline queue.
6. End-to-end browser test against the live backend.
7. GitHub Actions: checks, APK, website, backend deploy.
8. Demo data (with a one-line way to clear it), README, report.

## 5. Known limits

- Phone numbers aren't verified by SMS (needs a paid provider).
- No push notifications (needs Firebase); in-app and email cover every message.
- The APK is signed with a debug key: fine for installing directly, not for the Play Store.
- No iPhone app build (needs a paid Apple account); iPhone uses the website.
- The website needs a connection to open the first time; once open it keeps working through a dropped connection.
