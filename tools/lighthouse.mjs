/**
 * Lighthouse over every page: `npm run audit`.
 *
 * Runs against the local Pages-shaped server, on mobile emulation with throttling
 * (Lighthouse's default, and the harsher of the two profiles). Prints the four
 * category scores per page and exits non-zero if accessibility or SEO slips below
 * the thresholds below — those two are the ones this site should never regress.
 *
 * Full HTML reports land in tools/reports/ (git-ignored).
 */

import { launchChromium } from './browser.mjs';
import lighthouse from 'lighthouse';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serve } from './static-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'tools', 'reports');

const PAGES = ['', 'repapp', 'red-thread', 'between-the-lines', 'hospital-wayfinding'];

/* A perfect performance score is not the goal — the board is a deliberately
   animated canvas and the case studies carry large photographs. Accessibility
   and SEO are the ones held to a hard line. */
const FLOOR = { accessibility: 95, seo: 100 };

const { server, origin } = await serve(ROOT);
const browser = await launchChromium({ args: ['--remote-debugging-port=9222'] });

await mkdir(OUT, { recursive: true });

const rows = [];
const failures = [];

try {
  for (const slug of PAGES) {
    const url = `${origin}/${slug}`;
    const { lhr, report } = await lighthouse(url, {
      port: 9222,
      output: 'html',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    });

    if (lhr.runtimeError) {
      throw new Error(`${url} — Lighthouse could not audit this page: ` +
                      `${lhr.runtimeError.code} ${lhr.runtimeError.message}`);
    }

    const score = c => Math.round((lhr.categories[c]?.score ?? 0) * 100);
    const row = {
      page: slug || '(board)',
      performance: score('performance'),
      accessibility: score('accessibility'),
      'best-practices': score('best-practices'),
      seo: score('seo'),
    };
    rows.push(row);

    for (const [cat, floor] of Object.entries(FLOOR)) {
      if (row[cat] < floor) failures.push(`${row.page}: ${cat} ${row[cat]} < ${floor}`);
    }

    /* keep the failing audits close at hand — the score alone never says why */
    for (const cat of ['accessibility', 'seo']) {
      for (const ref of lhr.categories[cat].auditRefs) {
        const a = lhr.audits[ref.id];
        if (a && a.score !== null && a.score < 1) {
          console.log(`  ${(slug || 'board').padEnd(22)} ${cat}/${ref.id}: ${a.title}`);
        }
      }
    }

    await writeFile(join(OUT, `${slug || 'index'}.html`), report, 'utf8');
  }
} finally {
  await browser.close();
  server.close();
}

console.table(rows);
console.log(`\nReports: tools/reports/`);

if (failures.length) {
  console.error('\nBelow threshold:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('Accessibility and SEO thresholds met on every page.');
