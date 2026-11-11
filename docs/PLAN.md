# SplitIt build plan

Source: [PRD.md](PRD.md). This plan covers how the app works, the stack, the decisions already made, the questions that need the owner, and the build order.

## 1. How it works

A user signs up with phone, email and password. They create a group, add members by phone or email, and record expenses. Each expense stores who paid and an exact per-person split in paise. Group balances are the sum of what each member paid minus what they owe, adjusted by completed settlements only. The Balances tab shows a simplified list of transfers that clears every debt.

To settle, the debtor opens their UPI app from a deep link (or a QR code on iOS), pays the creditor directly, and marks the payment as paid. The creditor confirms or declines. The debt clears only on confirmation. Cash follows the same two-step path. A daily server job reminds debtors of debts older than 3 days and nudges creditors who have not answered a claim for 3 days.

The phone keeps a local copy of everything it has loaded. Expenses created offline go into a local queue and sync when the network returns.

## 2. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | React Native with Expo (TypeScript), Expo Router | Native Android and iOS from one codebase, as the PRD prefers |
| Backend | Supabase: Postgres, Auth, Storage, Edge Functions, pg_cron | Real database with row-level security, so the group isolation rule is enforced in the database itself, not in app code |
| Local store | SQLite on device (expo-sqlite) with an outbox table | Survives force-close; supports offline reads and queued writes |
| Bill scanning | Edge Function calling a Claude vision model | Key stays on the server; returns structured line items |
| Email | Resend, called from Edge Functions; also used as Supabase Auth SMTP | Password reset, payment request, claim, confirmation, reminder |
| Push | Expo push notifications | In-app notifications are built first; push is added on top |
| Error reporting | Sentry in the app and in Edge Functions | Captures native crashes with screen and stack trace |
| Backend deploy | GitHub Actions: migrations and functions deploy on push to main | PRD requires automated deployment from the repository |
| Android build | GitHub Actions: Expo prebuild then Gradle, APK as a downloadable artifact | No extra account needed; the build is reproducible outside any platform |
| Region | ap-south-1 (Mumbai) | Lowest latency for Indian users |

## 3. Key design decisions

**Money.** Every amount is an integer number of paise in the database, the API and the app. Rupees appear only in formatting (`₹1,234.50`, Indian digit grouping) and in the UPI link.

**Splits.** One shared pure function computes splits for all four types and is used by the app (live preview) and re-run on the server (validation). Rounding remainders go to the payer; if the payer is not in the split, the remainder goes to the first participant. A database trigger rejects any expense whose splits do not sum to its total.

**Balances.** Net position per member = paid minus owed, plus completed settlements sent, minus completed settlements received. Simplification uses greedy largest-debtor to largest-creditor matching, which needs at most n-1 transfers. Finding the true minimum is NP-hard in general; for groups of up to about 12 members the plan includes an exact search so the result is provably minimal at realistic sizes.

**Settlements.** State machine: `pending` to `marked_paid` to `completed` or `declined`. All transitions are database functions that check the caller: only the payer can mark paid, only the receiver can confirm or decline. A declined or abandoned settlement leaves the debt untouched, and the payer can start again. Pending and marked-paid settlements never change balances.

**Authorisation.** Row-level security on every table, keyed on group membership. Admin-only actions (rename, delete, member changes, editing others' expenses) are enforced by policy. Writes that touch several tables go through database functions so they are atomic and validated server-side. An automated test suite signs in as a non-member and attempts every read and write.

**Auth.** Sign-up is handled by an Edge Function that creates the account with phone, email and password, so phone + password login works without an SMS provider. Password reset is by email with Supabase's single-use, time-limited tokens. Google sign-in uses Supabase's Google provider; a Google user is asked for their phone number on first login.

**Offline.** Reads come from the local SQLite copy and refresh from the server when online. Offline expense creation writes to the local copy and an outbox with a client-generated id, so retries are safe. Sync replays the outbox on reconnect. Edits carry the `updated_at` the client last saw; if the server row is newer, the last write still wins and the user gets a notice that a conflict happened. A banner shows offline state and the pending count. Settle Up is blocked offline with a clear message.

**Bill scan.** Upload goes to an Edge Function that checks type (JPEG or PNG by file signature) and size (10 MB), stores the image in private storage, and asks the vision model for line items, tax and service charge. The result is an editable list. Tax and service charge are spread in proportion to each person's item subtotal. Any failure drops the user into the same editable list, empty, for manual entry.

**Reminders.** pg_cron calls an Edge Function daily. It finds simplified debts older than 3 days, respects each debtor's daily, weekly or off preference, writes a `reminders` row and a notification, and sends the email. A debt that is settled no longer appears in the balance set, so reminders stop without extra logic. The same job sends the single 3-day nudge for unanswered claims.

**Performance.** Home reads one balance summary per group from a database function, not every expense. The expense feed is a virtualised list with keyset pagination, 30 per page.

## 4. Deviations and limits, stated up front

1. **Phone numbers are not verified by OTP.** The PRD asks for phone + password, not OTP, and OTP needs a paid SMS provider. The phone is a unique login identifier only.
2. **Minimum transfers** is exact for groups up to about 12 members and near-minimal above that (see Balances).
3. **iOS** is built from the same code but no TestFlight build is planned; it needs a paid Apple developer account. The PRD marks it as a bonus.
4. **Real-device checks cannot be done from the build environment.** Items 6, 13, 14 and 15 of the Definition of Done need a physical Android phone. I will verify everything else with automated tests and a phone-sized browser build, and give a short device checklist for those four.
5. **Push notifications on Android** need a Firebase project. Without it, in-app notifications and email still work, which the PRD accepts as the minimum.

## 5. What is needed from the owner

These are accounts and keys only the owner can create. Features are built either way; each one stays dormant until its key is added as a server secret.

| Item | Used for | Without it |
| --- | --- | --- |
| Approval to create a Supabase project "SplitIt" in the NeoCrew AI organisation | Database, auth, storage, functions | Nothing can be hosted |
| Resend API key and a sending domain | All emails | No emails; Definition of Done items 1 (reset), 7 and 10 only partly met |
| Anthropic API key | Bill scan | Scan falls back to manual entry every time |
| Google OAuth client (web and Android) | Google sign-in | Button hidden; phone + password still works |
| Sentry project DSN | Crash reporting | Item 13 not met |
| Firebase project (google-services.json) | Android push | In-app and email only |
| Supabase access token as a GitHub Actions secret | Automated backend deploy | Deploys are done by hand from this session |

The build environment also blocks some hosts today. When the build starts I will request access to the specific ones needed.

## 6. Hosting

The backend runs entirely on Supabase; there is no separate server to host. The Android app is distributed as an APK from GitHub Actions, and can later go to the Play Store. Expected running cost for a test deployment is zero on the free tiers of Supabase, Resend and Sentry, with two things to know: free Supabase projects pause after a period of inactivity, and bill scanning is charged per scan by the vision API. Exact current prices will be confirmed and recorded when each service is set up.

## 7. Build order

1. Repository scaffold, shared money and split library with unit tests
2. Database schema, row-level security, database functions, seed data, isolation tests
3. Auth screens and profile
4. Home, group create and edit, group detail
5. Add expense with all four split types
6. Balances and settle-up flow, notifications, activity
7. Offline store, outbox and sync
8. Bill scan
9. Email, reminders job, push
10. Sentry, CI for backend deploy and APK build, README
11. Full pass against the 15 Definition of Done items, with a report of what passed, what failed and what needs a device

## 8. Benchmark record

Tokens, cost and time are measured from the session transcript with `scripts/usage-report.py`, split by stage using `docs/benchmark/stages.json`. A snapshot is committed at the end of each stage. Cost is tokens multiplied by the published API rates on the day of the report.
