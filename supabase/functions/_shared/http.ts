export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

/** A message safe to show a person, plus an HTTP status. Anything else is reported as a generic error. */
export class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function appUrl(): string {
  return (Deno.env.get('APP_URL') || 'https://shriharshagithub.github.io/splitit-claude').replace(/\/+$/, '');
}
