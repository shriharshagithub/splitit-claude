// Minimal Sentry reporter for edge functions (envelope API). Does nothing without SENTRY_DSN.
const dsn = Deno.env.get('SENTRY_DSN');

export async function captureException(err: unknown, context: Record<string, unknown> = {}): Promise<void> {
  console.error(err);
  if (!dsn) return;
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    const key = u.username;
    const endpoint = `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`;
    const e = err instanceof Error ? err : new Error(String(err));
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'javascript',
      level: 'error',
      server_name: 'supabase-edge',
      environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
      tags: { function: String(context.function ?? 'unknown') },
      extra: context,
      exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: (e.stack ?? '').split('\n').slice(1, 30).reverse().map((l) => ({ function: l.trim() })) } }] },
    };
    const body = `${JSON.stringify({ event_id: eventId, dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}`;
    await fetch(endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/x-sentry-envelope' } });
  } catch (reportErr) {
    console.error('sentry report failed', reportErr);
  }
}
