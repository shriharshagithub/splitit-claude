// Minimal Sentry reporting for edge functions (no SDK needed). Active only when SENTRY_DSN is set.
export async function reportError(err: unknown, fn: string, extra: Record<string, unknown> = {}): Promise<void> {
  console.error(`[${fn}]`, err, extra);
  const dsn = Deno.env.get('SENTRY_DSN');
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/\//g, '');
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const e = err instanceof Error ? err : new Error(String(err));
    const event = {
      event_id: eventId, timestamp: Date.now() / 1000, platform: 'javascript', level: 'error', server_name: fn,
      tags: { function: fn, runtime: 'supabase-edge' }, extra,
      exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: (e.stack ?? '').split('\n').slice(1).reverse().map((l) => ({ function: l.trim() })) } }] },
    };
    const body = `${JSON.stringify({ event_id: eventId, dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${u.username}&sentry_version=7`, { method: 'POST', body });
  } catch (e) {
    console.error('sentry report failed', e);
  }
}
