# SplitIt

Group expense splitting for India. One person pays, SplitIt tracks who owes whom, and everyone settles over UPI. The app never holds or moves money.

- **App:** React Native with Expo (Android, iOS, and web from one codebase)
- **Backend:** Supabase: Postgres with row-level security, Auth, Storage, Edge Functions, pg_cron
- **Email:** Resend. **Bill reading:** OCR.space. **Crash reports:** Sentry.

Product brief: [docs/PRD.md](docs/PRD.md). Build plan and decisions: [docs/PLAN.md](docs/PLAN.md). Designs: [docs/design](docs/design).

## Try it

| What | Where |
| --- | --- |
| Android APK | GitHub → Actions → **Android APK** → latest run → Artifacts → `splitit-apk` |
| Web (iPhone, desktop) | https://shriharshagithub.github.io/splitit-claude (after Pages is enabled, see below) |
| iPhone without TestFlight | Run `npx expo start --tunnel` and scan the QR code with the free **Expo Go** app (needs a free Expo account). Native crash capture and the UPI app chooser only work in a real build. |

Demo accounts (password `SplitIt@2026` for all). **These were removed from the live project on request so it could be used for real testing; run `supabase/seed.sql` to restore them.**

| Name | Phone | Groups |
| --- | --- | --- |
| Priya Sharma | 98860 54321 | Goa Trip (admin), Flat 402 |
| Ravi Kumar | 98450 12345 | Goa Trip, Flat 402 (admin) |
| Ananya Iyer | 99000 11223 | Goa Trip |
| Arjun Mehta | 99000 45678 | Goa Trip, Flat 402 |
| Meera Nair | 98111 22334 | Goa Trip |

Demo accounts use `@example.com` addresses, so they never receive email, and `@example` UPI IDs, which no UPI app accepts, so a test payment can never reach a real person. To try a real UPI payment, put your own UPI ID on your own account and pay ₹1 from someone else's phone. Sign up with your own email to test password reset and payment emails.

## How it works

- **Money** is integer paise everywhere (database `bigint`, app `number`). Rupees exist only in formatting (`₹1,23,456.78`) and the UPI link.
- **Splits** (equal, exact, percentage, shares) are computed by the same rules in the app (live preview, [src/core/splits.ts](src/core/splits.ts)) and in the database (`public.compute_splits`), which is the source of truth. Rounding remainders go to the payer. A commit-time constraint trigger rejects any expense whose splits do not add up to its total.
- **Balances** are computed on the server (`public.group_nets`). The "who pays whom" list is the minimum number of payments: an exact subset search for groups of up to 16 people with a balance, greedy matching beyond that ([src/core/simplify.ts](src/core/simplify.ts)).
- **Authorisation** is enforced in the database. Every table has row-level security keyed on group membership. Every write goes through a `security definer` function that checks the caller (admin-only actions, only the payer can mark paid, only the receiver can confirm). Internal helper functions cannot be called by app users.
- **UPI settlement:** the payer starts a settlement (`pending`), pays in their own UPI app through a `upi://pay` link (Android) or a QR code (iPhone and web), then marks it paid (`marked_paid`). The receiver confirms (`completed`, the debt clears) or declines (`declined`, the debt stays). Cash works the same way.
- **Reminders:** pg_cron calls the `reminders` edge function every day at 09:00 IST. It reminds anyone who has owed money in a group for more than 3 days, following their daily, weekly or off setting, and nudges receivers who have left a payment claim unanswered for 3 days.
- **Offline:** server data is cached on the device for a week, so groups, expenses and balances stay readable offline. New, edited and deleted expenses go into a queue in device storage that survives a force-close, and the queue syncs on reconnect. The server applies last-write-wins and tells the app when it overwrote someone else's edit, and the app shows that notice. Settling up needs a connection.
- **Invites:** adding a phone number or email that is not on SplitIt creates an invite. Email invites are sent automatically; phone invites get a link to share on WhatsApp or SMS. Signing up from the link (or with that phone or email) joins the group automatically.

## Repository layout

```
src/app/            screens (Expo Router)
src/core/           pure logic shared by app and server: money, splits, simplify, UPI link, bill text parser
src/lib/            API, offline queue, auth, query cache
supabase/migrations database schema, security, functions, cron job
supabase/functions  edge functions: signup, login, scan-bill, notify-email, reminders
supabase/seed.sql   demo data
supabase/tests      authorisation and arithmetic checks (SQL)
tests/              unit tests (vitest) and the end-to-end browser test
.github/workflows   CI, backend deploy, Android APK, web deploy
```

## Run locally

```bash
npm ci
```

```bash
cp .env.example .env
```

```bash
npx expo start
```

Press `a` for an Android emulator, scan the QR code with Expo Go on a phone, or press `w` for the browser.

Checks:

```bash
npx tsc --noEmit
```

```bash
npx vitest run
```

End-to-end test against the live backend (creates and needs cleanup of a throwaway user and group):

```bash
npx expo export -p web --output-dir dist && node tests/e2e/serve.js "$PWD/dist" & node tests/e2e/flows.js /tmp
```

Authorisation tests: run [supabase/tests/authorization.sql](supabase/tests/authorization.sql) in the Supabase SQL editor on a seeded database. Every row should show `pass = true`.

## Set up your own backend

1. Create a Supabase project. Apply the migrations in `supabase/migrations` in order (`supabase db push`), then run `supabase/seed.sql` for demo data.
2. In the SQL editor, create the two Vault secrets the database hooks use:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hook_secret');
   ```
3. Deploy the functions: `supabase functions deploy` (settings in `supabase/config.toml`).
4. Edge Function secrets (Dashboard → Edge Functions → Secrets):
   - `RESEND_API_KEY`: email. Without a verified domain, Resend only delivers to your own address.
   - `RESEND_FROM` (optional), for example `SplitIt <hello@yourdomain.com>` once the domain is verified.
   - `OCR_SPACE_API_KEY`: bill reading. Free key from ocr.space/ocrapi. Without it, Scan bill falls back to manual entry.
   - `SENTRY_DSN` (optional): server-side error reports.
   - `APP_URL` (optional): where email links point. Defaults to the GitHub Pages URL.
5. Authentication settings (Dashboard → Authentication):
   - **URL Configuration:** Site URL `https://shriharshagithub.github.io/splitit-claude`; add redirect URLs `https://shriharshagithub.github.io/splitit-claude/**` and `splitit://**`.
   - **Emails → SMTP settings:** host `smtp.resend.com`, port `465`, user `resend`, password = your Resend API key. Without this, password-reset emails use Supabase's test mailer, which only sends a few emails an hour.
   - **Providers → Google (optional):** add the Google OAuth client ID and secret.
6. Put your project URL and publishable key in `.env` and in the two app workflows.

## Automated deployment

| Workflow | Runs on | Needs |
| --- | --- | --- |
| CI | every push and PR | nothing |
| Deploy backend | push to `main` touching `supabase/` | repository secrets `SUPABASE_ACCESS_TOKEN` (Supabase → Account → Access tokens) and `SUPABASE_DB_PASSWORD` |
| Android APK | every push | nothing. Optional repository variable `SENTRY_DSN` |
| Web app | every push | Settings → Pages → Source: **GitHub Actions**. Optional variable `SENTRY_DSN` |

## Known limits

- Phone numbers are a login identifier but are not verified by OTP; that needs a paid SMS provider. Phone login goes through the `login` edge function, which looks up the account and signs in with its email and password, because Supabase's built-in phone login requires SMS.
- The APK is signed with the debug key, which is fine for side-loading and testing. Play Store release needs a proper keystore.
- Push notifications are not set up. In-app notifications and email cover payment requests, claims and reminders.
- OCR.space's free tier reads images up to 1 MB. The app shrinks photos before upload, and larger files fall back to manual entry.
- The web version does not work offline from a cold start (there is no service worker), though it stays usable if the connection drops while it is open. The native app works fully offline.
