# SplitIt: setup checklist

**Never paste a secret key into a chat with Claude or anyone else.** Every secret below goes straight into the website that needs it (the Supabase dashboard or GitHub settings). If a key ever ends up in a chat, create a new one and delete the old one.

"Public" values are safe to share. They are built into the app anyway.

| # | What | What it's for | Where to get it | Which value | Where to put it | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Supabase project | The database, logins, file storage and server code | supabase.com → your organisation → project **Splitit-Claude-Code** | Nothing to copy | Already exists | Done |
| 2 | Resend API key | Sending emails (invites, payment messages, reminders, password reset) | resend.com → API Keys → Create | The key starting `re_` (secret) | Supabase → project → Edge Functions → Secrets → `RESEND_API_KEY` | Done (already saved) |
| 3 | Resend sender address | The "From" line on emails, on your verified domain | resend.com → Domains (must say Verified) | An address such as `SplitIt <hello@thewowlabzteam.site>` | Supabase → Edge Functions → Secrets → `RESEND_FROM`. Optional: it already defaults to this address. Any format works: `hello@x.com`, `<hello@x.com>` or `SplitIt <hello@x.com>`. | Default in place |
| 4 | Resend as the login email sender | Password-reset emails come from your domain, without Supabase's limit of a few emails an hour | Supabase → Authentication → Emails → SMTP Settings | Host `smtp.resend.com`, port `465`, username `resend`, password = your Resend key (secret) | Same page, then Save | **You need to do this** |
| 5 | OCR.space key | Reading bill photos | ocr.space/ocrapi → "Register for free API key" (arrives by email) | The key (secret) | Supabase → Edge Functions → Secrets → `OCR_SPACE_API_KEY` | Optional. Until then the app uses OCR.space's public demo key, which works but is rate-limited. |
| 6 | Google sign-in | The "Continue with Google" button | console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID → Web application. Authorised redirect URI: `https://ohawfftzgjuqwbilovmy.supabase.co/auth/v1/callback` | Client ID (public) and Client secret (secret) | Supabase → Authentication → Sign In / Providers → Google → turn on, paste both | **You need to do this**. The button shows but says Google sign-in isn't switched on yet until you do. |
| 7 | Supabase login links | Where password-reset and Google links send people back to | Supabase → Authentication → URL Configuration | Site URL `https://shriharshagithub.github.io/splitit-claude`; Redirect URLs `https://shriharshagithub.github.io/splitit-claude/**` and `splitit://**` | Same page | **You need to do this** |
| 8 | Sentry DSN | Crash reports from the app and the server | sentry.io → Create project → React Native → Settings → Client Keys (DSN) | The DSN (public, starts `https://`) | GitHub → repository → Settings → Secrets and variables → Actions → **Variables** → `SENTRY_DSN`; and Supabase → Edge Functions → Secrets → `SENTRY_DSN` | Optional, **you need to do this** for crash reports |
| 9 | GitHub Pages | Publishing the website | GitHub → repository → Settings → Pages | Source: **GitHub Actions** | Same page | Already on for this repository |
| 10 | Supabase access token | Lets GitHub deploy database and server changes automatically | supabase.com → Account → Access Tokens → Generate | The token (secret) | GitHub → repository → Settings → Secrets and variables → Actions → **Secrets** → `SUPABASE_ACCESS_TOKEN` | **You need to do this** for automatic backend deploys |
| 11 | Database password | Same as above | Supabase → project → Database → Settings → Reset database password (if you don't have it) | The password (secret) | GitHub Secrets → `SUPABASE_DB_PASSWORD` | **You need to do this** for automatic backend deploys |

All values marked "public" are already in the code. Nothing else is needed for the app to run.
