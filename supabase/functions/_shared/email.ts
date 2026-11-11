const APP_URL = (Deno.env.get('APP_URL') ?? 'https://shriharshagithub.github.io/splitit-claude').replace(/\/$/, '');
const DEFAULT_FROM = 'SplitIt <hello@thewowlabzteam.site>';

/** Accepts "Name <a@b.c>", "a@b.c" or a bare domain "b.c"; anything else falls back to the default. */
export function senderFrom(raw: string | undefined): string {
  const v = (raw ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!v) return DEFAULT_FROM;
  const named = v.match(/^([^<>@]*)<\s*([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*>$/);
  if (named) return `${named[1].trim().replace(/^["']+|["']+$/g, '') || 'SplitIt'} <${named[2]}>`;
  if (/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v)) return `SplitIt <${v}>`;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) return `SplitIt <hello@${v}>`;
  return DEFAULT_FROM;
}

const FROM = senderFrom(Deno.env.get('RESEND_FROM'));

export const appLink = (path: string) => `${APP_URL}${path}`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function renderEmail(opts: { heading: string; body: string; button?: { label: string; url: string } }): string {
  const btn = opts.button
    ? `<p style="margin:24px 0"><a href="${esc(opts.button.url)}" style="background:#2b2f8f;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px;display:inline-block">${esc(opts.button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f5f5fb;font-family:Arial,Helvetica,sans-serif;color:#15163a">
<div style="max-width:480px;margin:0 auto;padding:24px 16px">
<p style="font-weight:700;font-size:20px;margin:0 0 16px">SplitIt</p>
<div style="background:#ffffff;border:1px solid #d6d7e6;border-radius:14px;padding:20px">
<h1 style="font-size:18px;margin:0 0 8px">${esc(opts.heading)}</h1>
<p style="font-size:16px;line-height:24px;margin:0">${esc(opts.body)}</p>${btn}
</div>
<p style="font-size:12px;color:#54567a;margin-top:16px">You get this email because you use SplitIt. Change reminder emails in Profile.</p>
</div></body></html>`;
}

/** Returns null on success, or a short reason the email was not sent. */
export async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return 'RESEND_API_KEY not set';
  if (/@example\.(com|org|net)$/i.test(to)) return 'demo address';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  if (!res.ok) return `resend ${res.status} (from ${FROM}): ${(await res.text()).slice(0, 200)}`;
  return null;
}
