/**
 * Local preview on a GitHub-Pages-shaped server: `npm run serve`.
 *
 * Worth using instead of opening the files directly, because it is the only way
 * to see the things Pages does and file:// does not — extensionless URLs and the
 * 404 page.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { origin } = await serve(ROOT);

console.log(`\n  ${origin}\n`);
for (const p of ['repapp', 'red-thread', 'between-the-lines', 'hospital-wayfinding']) {
  console.log(`    ${origin}/${p}`);
}
console.log('\n  Ctrl-C to stop.\n');
