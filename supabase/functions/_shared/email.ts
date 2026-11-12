import { appUrl } from './http.ts';

const DEFAULT_FROM = 'SplitIt <hello@thewowlabzteam.site>';

/**
 * Accepts the sender in any common shape and returns "Name <address>":
 *   hello@x.com | <hello@x.com> | SplitIt <hello@x.com> | "SplitIt" <hello@x.com> | 'SplitIt<hello@x.com>' | mailto:hello@x.com
 * Returns null if no address can be found.
 */
export function normalizeFrom(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().replace(/^['"`]+|['"`]+$/g, '').replace(/mailto:/gi, '').trim();
  const addr = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/.exec(s)?.[1];
  if (!addr) return null;
  const name = s.slice(0, s.indexOf(addr)).replace(/[<>"'`]/g, '').trim() || 'SplitIt';
  return `${name} <${addr.toLowerCase()}>`;
}

export function fromAddress(): string {
  return normalizeFrom(Deno.env.get('RESEND_FROM')) ?? DEFAULT_FROM;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Simple, readable email: heading, a few lines, one button. */
export function renderEmail(o: { heading: string; lines: string[]; button?: { label: string; url: string }; footer?: string }): string {
  const btn = o.button
    ? `<p style="margin:28px 0"><a href="${esc(o.button.url)}" style="background:#F59E0B;color:#2A1700;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px;display:inline-block">${esc(o.button.label)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#F4F7F6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#10201E">
<div style="max-width:520px;margin:0 auto;padding:24px">
<div style="font-weight:800;font-size:20px;color:#0F766E;margin-bottom:16px">SplitIt</div>
<div style="background:#fff;border-radius:16px;padding:24px;border:1px solid #DCE5E3">
<h1 style="font-size:20px;margin:0 0 12px">${esc(o.heading)}</h1>
${o.lines.map((l) => `<p style="font-size:16px;line-height:1.5;margin:0 0 10px">${esc(l)}</p>`).join('')}
${btn}
</div>
<p style="font-size:13px;color:#5A6B68;margin-top:16px">${esc(o.footer ?? 'You get these emails because you use SplitIt. Change reminder emails in Profile → Reminders.')} <a href="${appUrl()}" style="color:#0F766E">Open SplitIt</a></p>
</div></body></html>`;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  // Demo and test accounts use reserved domains that can never receive mail: don't send (avoids bounces).
  if (/@(.+\.)?(example\.(com|org|net)|test|invalid)$/i.test(to.trim())) return { ok: true, id: 'skipped-reserved-domain' };
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' };
  const from = fromAddress();
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, error: `Resend ${r.status} (from "${from}"): ${body?.message ?? JSON.stringify(body)}` };
  return { ok: true, id: body?.id };
}
