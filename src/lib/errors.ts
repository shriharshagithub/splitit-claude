/** An error whose message is safe and useful to show to the user. */
export class AppError extends Error {
  constructor(message: string, public kind: 'user' | 'network' | 'auth' | 'unknown' = 'user') {
    super(message);
  }
}

const NETWORK = /network request failed|failed to fetch|load failed|networkerror|fetch failed|timeout|aborted/i;

export function isNetworkError(e: unknown): boolean {
  return (e instanceof AppError && e.kind === 'network') || (e instanceof Error && NETWORK.test(e.message));
}

/** Turn anything thrown by Supabase or fetch into an AppError with a human message. Never shows a stack trace. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const anyE = e as { message?: string; code?: string; status?: number } | null;
  const msg = anyE?.message ?? '';
  if (NETWORK.test(msg)) return new AppError('You are offline or the connection dropped. Try again when you are back online.', 'network');
  if (anyE?.code === 'P0001' && msg) return new AppError(msg, 'user');
  if (anyE?.code === 'PGRST301' || anyE?.status === 401 || /jwt|refresh token/i.test(msg)) {
    return new AppError('Your session has ended. Please log in again.', 'auth');
  }
  if (/invalid login credentials/i.test(msg)) return new AppError('That email or password is not right.', 'auth');
  return new AppError('Something went wrong. Please try again.', 'unknown');
}

/** Message to show for any caught error: our own validation messages pass through, anything else is made safe. */
export function errText(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof Error && e.constructor === Error && e.message && !NETWORK.test(e.message)) return e.message;
  return toAppError(e).message;
}
