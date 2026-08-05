/**
 * Smoke test for the board and the case studies: `npm test`.
 *
 * Everything here is a regression that actually happened once. In particular the
 * mobile block: the polaroid's transparent click-catcher lost its containing
 * block in the stacked layout and covered the entire column, so every tap on the
 * folders and the contact card hit an invisible sheet instead. Nothing about the
 * page looked wrong — only tapping it was. Hence: assert what is on top at the
 * point a finger lands, not just that the element exists.
 */

import { launchChromium } from './browser.mjs';
import { serve } from './static-server.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = ['repapp', 'red-thread', 'between-the-lines', 'hospital-wayfinding'];

const pass = [], fail = [];
const check = (ok, msg) => (ok ? pass : fail).push(msg);

const IPHONE = {
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
             '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

/** Is `sel` the thing a tap at its own centre would actually reach? */
const topmostAt = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  if (!hit) return { reachable: false, blockedBy: 'nothing at that point' };
  if (el.contains(hit) || hit.closest(s) === el) return { reachable: true };
  const b = hit.closest('[data-k]') || hit;
  return { reachable: false, blockedBy: b.dataset?.k ? `.obj[data-k="${b.dataset.k}"]` : (b.className || b.tagName) };
}, sel);

const { server, origin } = await serve(ROOT);
const browser = await launchChromium();

/* A blocked element makes Playwright's tap() hang until it times out, so a
   layout regression surfaces as a crash rather than a failed assertion. Keep the
   waits short and report whatever was collected before the throw — the checks
   that already ran usually name the culprit. */
browser.contexts().forEach(c => c.setDefaultTimeout(8000));
let crashed = null;

try {
  /* ================= MOBILE ================= */
  const mob = await browser.newContext(IPHONE);
  const m = await mob.newPage();
  await m.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(3200);

  /* the polaroid overlay must cover the polaroid and nothing else */
  const overlay = await m.evaluate(() => {
    const pol = document.querySelector('.obj[data-k="pol"]');
    const pos = getComputedStyle(pol).position;
    return { positioned: pos !== 'static', pos, h: Math.round(pol.getBoundingClientRect().height),
             boardH: Math.round(document.getElementById('board').getBoundingClientRect().height) };
  });
  check(overlay.positioned,
        `mobile: polaroid establishes a containing block (position:${overlay.pos}) — ` +
        `its overlay stays ${overlay.h}px tall, not ${overlay.boardH}px`);

  /* every contact action and every folder must be the topmost element at its centre */
  for (const [name, sel] of [
    ['Gmail', '.ic[data-a="mail"]'], ['LinkedIn', '.ic[data-a="li"]'], ['Resume', '.ic[data-a="cv"]'],
    ...CASES.map(c => [c, `a[href="${c === 'repapp' ? 'repapp' : c}.html"]`]),
  ]) {
    const r = await topmostAt(m, sel);
    check(r.reachable, `mobile: ${name} is tappable${r.reachable ? '' : ` — blocked by ${r.blockedBy}`}`);
  }

  /* mailto must reach the mail app on a phone: the handler has to let it through */
  await m.evaluate(() => document.querySelector('.ic[data-a="mail"]').scrollIntoView({ block: 'center' }));
  const mailto = await m.evaluate(async () => {
    const a = document.querySelector('.ic[data-a="mail"]');
    let prevented = null;
    const spy = e => { prevented = e.defaultPrevented; e.preventDefault(); };  // stop the real navigation
    a.addEventListener('click', spy);
    a.click();
    a.removeEventListener('click', spy);
    return { prevented, href: a.getAttribute('href') };
  });
  check(mailto.prevented === false && mailto.href.startsWith('mailto:'),
        `mobile: Gmail opens the mail app (mailto: not intercepted)`);

  /* The two target="_blank" links must open a tab rather than be swallowed.
     What we assert is that the tap produced a popup aimed at the right href —
     NOT that the page loaded, since LinkedIn is off the network in CI and would
     land on chrome-error:// through no fault of the markup. */
  for (const [name, sel, want] of [
    ['LinkedIn', '.ic[data-a="li"]', 'linkedin.com'],
    ['Resume', '.ic[data-a="cv"]', '.pdf'],
  ]) {
    await m.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
    const href = await m.getAttribute(sel, 'href');
    const [popup] = await Promise.all([
      m.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
      m.locator(sel).tap(),
    ]);
    check(popup !== null && href.toLowerCase().includes(want),
          `mobile: ${name} opens a new tab at ${href.slice(0, 60)}` +
          (popup ? '' : ' — NO TAB OPENED'));
    if (popup) await popup.close();
  }

  /* a folder tap navigates */
  await m.evaluate(() => document.querySelector('a[href="red-thread.html"]').scrollIntoView({ block: 'center' }));
  await Promise.all([
    m.waitForURL('**/red-thread.html', { timeout: 5000 }).catch(() => {}),
    m.locator('a[href="red-thread.html"]').tap(),
  ]);
  check(m.url().endsWith('/red-thread.html'), `mobile: folder tap navigates → ${m.url().replace(origin, '')}`);

  /* the polaroid still flips */
  await m.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await m.waitForTimeout(3200);
  await m.evaluate(() => document.querySelector('.obj[data-k="pol"]').scrollIntoView({ block: 'center' }));
  await m.locator('.obj[data-k="pol"]').tap();
  await m.waitForTimeout(500);
  check(await m.evaluate(() => document.querySelector('.obj[data-k="pol"]').classList.contains('flipped')),
        'mobile: the polaroid still flips to the about note');
  await mob.close();

  /* ================= DESKTOP ================= */
  const d = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await d.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await d.waitForTimeout(3200);

  const folders = await d.$$eval('#fan > *', els => els.map(e => ({ tag: e.tagName, href: e.getAttribute('href') })));
  check(folders.length === 4 && folders.every(f => f.tag === 'A' && f.href),
        `desktop: all four folders are real <a href> (${folders.map(f => f.href).join(', ')})`);

  for (const [name, sel] of [['Gmail', '.ic[data-a="mail"]'], ['LinkedIn', '.ic[data-a="li"]'], ['Resume', '.ic[data-a="cv"]']]) {
    const r = await topmostAt(d, sel);
    check(r.reachable, `desktop: ${name} is clickable${r.reachable ? '' : ` — blocked by ${r.blockedBy}`}`);
  }

  /* on a desktop mailto: often dead-ends, so the click copies instead — the
     opposite of the phone, and the reason mobile needs its own assertion above */
  const deskMail = await d.evaluate(() => {
    const a = document.querySelector('.ic[data-a="mail"]');
    let prevented = null;
    const spy = e => { prevented = e.defaultPrevented; e.preventDefault(); };
    a.addEventListener('click', spy); a.click(); a.removeEventListener('click', spy);
    return prevented;
  });
  check(deskMail === true, 'desktop: Gmail copies the address instead of firing mailto:');

  /* dragging a folder must not follow its href */
  const box = await d.locator('a[href="red-thread.html"]').boundingBox();
  await d.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await d.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await d.mouse.move(box.x + box.width / 2 + i * 12, box.y + box.height / 2 + i * 5);
    await d.waitForTimeout(16);
  }
  await d.mouse.up();
  await d.waitForTimeout(500);
  const after = await d.locator('a[href="red-thread.html"]').boundingBox();
  check(Math.hypot(after.x - box.x, after.y - box.y) > 40, 'desktop: a folder still drags');
  check(!d.url().includes('red-thread'), 'desktop: a drag does not navigate');

  await Promise.all([
    d.waitForURL('**/red-thread.html', { timeout: 5000 }).catch(() => {}),
    d.mouse.click(after.x + after.width / 2, after.y + after.height / 2),
  ]);
  check(d.url().endsWith('/red-thread.html'), 'desktop: a click does navigate');

  /* keyboard */
  await d.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await d.waitForTimeout(3200);
  await d.evaluate(() => document.querySelector('a[href="repapp.html"]').focus());
  const ring = await d.evaluate(() => getComputedStyle(document.querySelector('a[href="repapp.html"] .folder')).outlineWidth);
  check(parseFloat(ring) >= 2, `desktop: focused folder shows a ${ring} focus ring`);
  await Promise.all([
    d.waitForURL('**/repapp.html', { timeout: 5000 }).catch(() => {}),
    d.keyboard.press('Enter'),
  ]);
  check(d.url().endsWith('/repapp.html'), 'desktop: Enter opens the focused folder');

  /* ================= CASE STUDIES ================= */
  for (const slug of CASES) {
    await d.goto(`${origin}/${slug}`, { waitUntil: 'networkidle' });
    const r = await d.evaluate(() => {
      const ids = [...document.querySelectorAll('#article section.sec')].map(s => s.id);
      return { n: ids.length, dupes: ids.length !== new Set(ids).size,
               h1: document.querySelectorAll('h1').length,
               toc: document.querySelectorAll('#toc li').length };
    });
    check(r.n > 0 && !r.dupes && r.h1 === 1 && r.toc === r.n,
          `${slug}: ${r.n} sections, one <h1>, TOC matches, nothing duplicated`);
  }

  /* the prerendered text is there with scripting off */
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const n = await nojs.newPage();
  for (const slug of CASES) {
    await n.goto(`${origin}/${slug}`, { waitUntil: 'domcontentloaded' });
    const r = await n.evaluate(() => ({
      chars: document.querySelector('#article').textContent.trim().length,
      opacity: getComputedStyle(document.querySelector('#article .reveal') || document.body).opacity,
    }));
    check(r.chars > 3000 && parseFloat(r.opacity) === 1,
          `${slug}: ${r.chars} chars readable with JS off`);
  }
  await nojs.close();

  const resp = await d.goto(`${origin}/does-not-exist`);
  check(resp.status() === 404, `unknown path returns ${resp.status()}`);

} catch (err) {
  crashed = err;
} finally {
  await browser.close();
  server.close();
}

pass.forEach(m => console.log('  ✓ ' + m));
if (fail.length) {
  console.log('');
  fail.forEach(m => console.log('  ✗ ' + m));
}
if (crashed) {
  console.log(`\n  ✗ the run stopped early: ${String(crashed).split('\n')[0]}`);
}
if (fail.length || crashed) {
  console.log(`\n${fail.length + (crashed ? 1 : 0)} failed, ${pass.length} passed.`);
  process.exit(1);
}
console.log(`\n${pass.length}/${pass.length} passed.`);
