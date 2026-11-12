# SplitIt

Split group expenses with friends in India, and settle up over UPI. SplitIt works out who owes whom in the fewest payments. Money goes straight from one person's UPI app to the other's: SplitIt never holds or moves money.

| | |
| --- | --- |
| **Website** (any phone, including iPhone, and computers) | https://shriharshagithub.github.io/splitit-claude |
| **Android app** | GitHub → Actions → **Android APK** → latest run → Artifacts → `splitit-apk` (unzip, then open the `.apk` on the phone) |
| **Backend** | Supabase project **Splitit-Claude-Code** (`ohawfftzgjuqwbilovmy`) |
| **Plan, design, setup** | [docs/PLAN.md](docs/PLAN.md), [docs/DESIGN.md](docs/DESIGN.md), [docs/SETUP.md](docs/SETUP.md) |
| **Product brief** | [docs/PRD.md](docs/PRD.md) |
| **Build report** | [docs/REPORT.md](docs/REPORT.md) |

## Try it with demo data

Log in with any of these (password **`SplitIt@2026`**). Demo emails use `@example.com` and demo UPI IDs use `@example`, so nothing can ever reach a real person.

| Name | Mobile number | Groups | Notes |
| --- | --- | --- | --- |
| Priya Sharma | 90000 00001 | Goa Trip (admin), Flat 402 | Owed the most |
| Ravi Kumar | 90000 00002 | Goa Trip, Flat 402 (admin) | Has a cash payment from Arjun waiting for his confirmation |
| Ananya Iyer | 90000 00003 | Goa Trip | Started a UPI payment to Priya |
| Arjun Mehta | 90000 00004 | Goa Trip, Flat 402 | Owes the most; has no UPI ID (shows the "Ask Arjun to add a UPI ID" case) |
| Meera Nair | 90000 00005 | Goa Trip | Has a confirmed payment to Priya |

**To remove the demo data:** Supabase → SQL Editor → paste and run [supabase/clear-demo.sql](supabase/clear-demo.sql). To add it back, run [supabase/seed.sql](supabase/seed.sql).

## How it works

- **Money** is whole paise everywhere (`bigint` in the database). Rupees only appear on screen (`₹1,23,456.78`) and in the UPI link.
- **Splits**: equal, exact amounts, percentages and shares. The database function `compute_splits` is the source of truth; the app runs the same rules ([src/core/splits.ts](src/core/splits.ts)) for the live preview. Leftover paise go to the payer. A check that runs when each save is committed refuses any expense whose shares don't add up to its total.
- **Fewest payments**: exact for up to 16 people with a balance (largest number of groups whose balances cancel out), greedy beyond that ([src/core/simplify.ts](src/core/simplify.ts)).
- **Security**: row-level security on every table, so people can only read their own groups. The app cannot write to any table directly. Every change goes through a `security definer` database function that checks who is calling: only admins manage members, only the payer can mark a payment as paid, and only the receiver can confirm or decline it.
- **Settle up**: the payer starts a payment (`pending`), pays in their UPI app, then marks it paid (`marked_paid`). The receiver confirms (`completed`, the debt clears) or declines (`declined`, the debt stays). Cash works the same way. Android (app and browser) opens the `upi://pay` link, which shows the phone's UPI apps; the Android manifest declares the `upi` scheme for Android 11+. iPhone and computers show a QR code plus the UPI ID with Copy.
- **Live updates**: database triggers send a small "something changed" message on a private Realtime channel per group. Only members can listen. Every open screen re-reads its data straight away.
- **Offline**: everything loaded is cached on the device for a week. Expenses added, edited or deleted offline go into a queue in device storage that survives closing the app, and sync on reconnect. If two people edited the same expense, the last save wins and the app says so.
- **Emails and reminders**: every in-app notification also triggers an email through pg_net and the `send-email` function (authenticated with a secret in Supabase Vault). pg_cron runs `reminders` at 09:00 IST: people who have owed someone money for more than 3 days get a reminder (daily, weekly or off, per person), and anyone who hasn't answered a payment claim for 3 days gets one nudge.
- **Bill scan**: the phone shrinks the photo under 1 MB and uploads it to a private bucket. The `scan-bill` function checks membership, file type (by its first bytes) and size, reads it with OCR.space, and parses items, tax, service charge, discount and total. If reading fails, the same screen opens empty for typing.

## Repository layout

```
src/app/            screens (Expo Router)
src/core/           shared logic: money, splits, fewest payments, UPI link, bill parser, dates, phone numbers
src/lib/            data loading, offline queue, live updates, login, theme
src/components/     buttons, inputs, date picker, offline banner
supabase/migrations database: tables, security rules, functions, live updates, storage, scheduled job
supabase/functions  server functions: signup, login, password-reset, send-email, scan-bill, reminders
supabase/seed.sql   demo data      supabase/clear-demo.sql removes it
tests/              unit tests, live backend security test, end-to-end browser test
.github/workflows   checks, Android APK, website, backend deploy
```

## Run and test

```bash
npm ci
```

```bash
npx expo start
```

Unit tests (money, splits with thousands of random cases, fewest payments against brute force, UPI link, bill parsing, offline queue):

```bash
npx vitest run
```

Live backend security and arithmetic test (63 checks; creates throwaway `e2e-…@example.com` users, removed by `scripts/clear-test-users.sql`):

```bash
NODE_USE_ENV_PROXY=1 node tests/api/backend.mjs
```

End-to-end browser test of the main flows against the live backend (32 steps):

```bash
npx expo export -p web --output-dir dist && (node tests/e2e/serve.mjs dist 8099 &) && node tests/e2e/flows.cjs /tmp
```

## Setting up your own copy

See [docs/SETUP.md](docs/SETUP.md) for every account and key, where to get it and where to put it. In short:

1. Create a Supabase project and apply `supabase/migrations` (`supabase db push`).
2. In the SQL Editor, create the two Vault secrets the database uses to call the server functions:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hook_secret');
   ```
3. `supabase functions deploy` and add the Edge Function secrets `RESEND_API_KEY` (plus optional `RESEND_FROM`, `OCR_SPACE_API_KEY`, `SENTRY_DSN`, `APP_URL`).
4. Put the project URL and publishable key in `src/lib/config.ts` (or `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY`).

## Known limits

- Mobile numbers are not verified by SMS (that needs a paid SMS provider).
- No push notifications (needs Firebase); in-app messages and email cover every case.
- The APK is signed with a debug key: fine for installing directly, not for the Play Store.
- No iPhone app build (needs a paid Apple developer account); iPhones use the website.
- The website needs a connection the first time it opens; after that it keeps working through a dropped connection.
- The backend is in Sydney (the region the project was created in), so each save takes about a second from India. A new project in Mumbai would be faster.
