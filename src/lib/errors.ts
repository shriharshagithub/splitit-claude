/** Turns any error into a sentence a person can act on. Never shows stack traces. */
export function friendlyError(e: unknown): string {
  const msg = (e as any)?.message ?? String(e ?? '');
  if (/Failed to fetch|Network request failed|fetch failed|NetworkError|No connection/i.test(msg)) return 'No connection. Check your internet and try again.';
  if (/JWT|session|refresh token|Please log in/i.test(msg)) return 'Your login has expired. Please log in again.';
  if (/coerce the result|0 rows|PGRST116/i.test(msg)) return "This doesn't exist, or you don't have access to it.";
  if (/duplicate key|already exists/i.test(msg)) return 'That already exists.';
  // Our database functions raise plain-language messages; pass those through.
  if (msg && msg.length < 200 && !/[{}]|violates|syntax|relation|column|function/i.test(msg)) return msg;
  return 'Something went wrong. Please try again.';
}
