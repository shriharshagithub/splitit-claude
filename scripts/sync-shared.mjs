// Copies the pure core modules into the edge functions folder (Deno needs explicit .ts imports).
// Run after changing src/core: node scripts/sync-shared.mjs  (CI fails if the copies drift).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const files = ['money', 'simplify', 'billText'];
mkdirSync('supabase/functions/_shared/core', { recursive: true });
for (const f of files) {
  const src = readFileSync(`src/core/${f}.ts`, 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  writeFileSync(`supabase/functions/_shared/core/${f}.ts`, `// GENERATED from src/core/${f}.ts by scripts/sync-shared.mjs. Do not edit.\n${src}`);
}
console.log('synced', files.join(', '));
