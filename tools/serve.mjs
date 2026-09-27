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
/* `node tools/serve.mjs 8090` pins the port; without an argument it is ephemeral. */
const { origin } = await serve(ROOT, Number(process.argv[2]) || 0);

console.log(`\n  ${origin}\n`);
for (const p of ['repapp', 'red-thread', 'between-the-lines', 'hospital-wayfinding', 'fleet-console']) {
  console.log(`    ${origin}/${p}`);
}
console.log('\n  Ctrl-C to stop.\n');
