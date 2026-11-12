// Copies the pure logic in src/core into supabase/functions/_shared/core so the edge functions
// run exactly the same money, split and parsing code as the app. CI fails if the copy is stale.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
const src = 'src/core';
const dst = 'supabase/functions/_shared/core';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (!f.endsWith('.ts')) continue;
  // Deno needs explicit file extensions on relative imports.
  const code = readFileSync(`${src}/${f}`, 'utf8').replace(/from '(\.\/[^']+)'/g, "from '$1.ts'");
  writeFileSync(`${dst}/${f}`, `// GENERATED from ${src}/${f} by scripts/sync-shared.mjs. Do not edit.\n${code}`);
}
