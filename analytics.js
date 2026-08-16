/* analytics.js — conversion measurement for the board and the case study pages.
 *
 * WHY THIS IS HAND-WRITTEN AND NOT POSTHOG'S CDN SNIPPET
 * The house rule for this site is "no build step, no frameworks, no external
 * dependencies beyond the Google fonts" (CLAUDE.md). PostHog's official
 * snippet pulls ~120KB of third-party JavaScript on a site that gets audited
 * with Lighthouse and is otherwise dependency-free. Everything that snippet
 * does for us here — send a handful of named events — is the fifty lines
 * below, posted to the same documented endpoint the official library posts to
 * (`/e/`, form-encoded `data=<base64>`).
 *
 * The trade is real and worth stating: no autocapture, no session recording,
 * no feature flags, no A/B tests. If any of those are ever wanted, this file
 * gets deleted and the official snippet goes in instead. For "how many people
 * open a case study and how many download the CV", this is enough.
 *
 * NO COOKIES, SO NO CONSENT BANNER
 * The visitor id lives in sessionStorage and dies when the tab closes. Nothing
 * is written to a cookie, nothing is shared across sites, and nobody is
 * followed between visits. That keeps the site outside the consent-banner
 * requirement while still letting one visit read as one visit — so "opened a
 * case study, then downloaded the CV" is still a funnel and not two strangers.
 * The cost: a returning visitor counts as a new one. For a portfolio that is
 * the right side of the trade.
 */
(function () {
  'use strict';

  /* ---------- configuration ---------- */

  /* Project API key from PostHog → Project settings. Public by design: it can
     only write events, never read them. NOT the personal key ("phx_…"), which
     would hand over the whole account.
     Empty key = this whole file is a no-op, which is what you want while
     working on the site locally. */
  var KEY  = 'phc_wbYZGRmnAzF5FrZyXT2dujFsWS8z2bWjD5mMMTawTCup';

  /* Must match the region the PostHog account was created in. EU accounts use
     the host below; a US account needs https://us.i.posthog.com or the events
     land nowhere, silently. */
  var HOST = 'https://eu.i.posthog.com';

  if (!KEY) return;

  /* ---------- transport ---------- */

  /* btoa() throws on anything outside Latin-1, and this site is bilingual with
     Norwegian æ/ø/å in titles and referrers. Encode to UTF-8 bytes first. */
  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', i;
    for (i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /* sendBeacon, because most of what we measure here is a click that leaves
     the page (a PDF, a case study, a mail client). A normal fetch would be
     cancelled by the navigation — exactly on the events that matter most.
     Form-encoded rather than JSON: application/x-www-form-urlencoded is
     CORS-safelisted, so the beacon goes out without a preflight it cannot do. */
  function send(event, props) {
    var payload = {
      api_key: KEY,
      event: event,
      properties: Object.assign(
        { distinct_id: visitor(), $current_url: location.origin + location.pathname },
        props || {}
      ),
      timestamp: new Date().toISOString()
    };
    try {
      var body = new Blob(['data=' + encodeURIComponent(b64(JSON.stringify(payload)))], {
        type: 'application/x-www-form-urlencoded'
      });
      navigator.sendBeacon(HOST + '/e/', body);
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  /* Per-visit id. try/catch because Safari in private mode and locked-down
     browsers throw on sessionStorage access rather than returning null. */
  function visitor() {
    try {
      var v = sessionStorage.getItem('ph:vid');
      if (!v) {
        v = (crypto.randomUUID && crypto.randomUUID()) ||
            Math.random().toString(36).slice(2) + Date.now().toString(36);
        sessionStorage.setItem('ph:vid', v);
      }
      return v;
    } catch (e) {
      return 'anon-' + Math.random().toString(36).slice(2);
    }
  }

  /* ---------- page identity ---------- */

  /* "/red-thread.html" → "red-thread", "/" → "board". A name, not a URL, so the
     numbers stay readable when a file is ever renamed. */
  function pageName() {
    var f = location.pathname.split('/').pop() || '';
    if (!f || f === 'index.html') return 'board';
    return f.replace(/\.html$/, '');
  }

  var PAGE = pageName();
  var isCaseStudy = PAGE !== 'board' && PAGE !== '404' && PAGE.indexOf('cv') !== 0;

  send('$pageview', { page: PAGE, lang: document.documentElement.lang || 'en' });

  /* ---------- drag guard ----------
   *
   * Everything on the board can be dragged, and letting go of a dragged object
   * fires a click. Counting those would inflate every number here: a folder
   * shoved aside would read as an opened case study, a card moved out of the
   * way as a CV download.
   *
   * The board already solves this for itself with a `suppressClick` flag, but
   * that flag is a local inside its inline script and cannot be read from here.
   * Reading `e.defaultPrevented` instead looks like a shortcut and is a trap:
   * the mail icon legitimately calls preventDefault() on desktop (it copies the
   * address rather than opening a dead mailto:), so that test would silently
   * drop every contact click from the one device class most visitors use.
   *
   * So: watch the pointer directly, with the same 3px threshold the board uses.
   * Capture phase, to run before any handler that might stop propagation.
   * Keyboard activation moves no pointer, so Enter on a folder still counts. */
  var downAt = null;
  var dragged = false;

  document.addEventListener('pointerdown', function (e) {
    downAt = { x: e.clientX, y: e.clientY };
    dragged = false;
  }, true);

  document.addEventListener('pointermove', function (e) {
    if (!downAt) return;
    if (Math.abs(e.clientX - downAt.x) > 3 || Math.abs(e.clientY - downAt.y) > 3) dragged = true;
  }, true);

  /* `dragged` deliberately survives pointerup — the click that follows is the
     one that has to be swallowed. It resets on the next pointerdown. */
  document.addEventListener('pointerup', function () {
    downAt = null;
  }, true);

  /* ---------- conversions ---------- */

  /* One delegated listener instead of per-element handlers: the board rebuilds
     and re-paints its objects, so anything bound directly would need rebinding.
     This also keeps the HTML edit down to a single <script> tag per page. */
  document.addEventListener('click', function (e) {
    if (dragged) return;

    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;

    /* CV — the strongest signal this site has. */
    if (a.dataset.a === 'cv') {
      send('cv_downloaded', { file: a.getAttribute('href'), page: PAGE });
      return;
    }

    if (a.dataset.a === 'mail') {
      send('contact_clicked', { channel: 'email', page: PAGE });
      return;
    }

    if (a.dataset.a === 'li') {
      send('contact_clicked', { channel: 'linkedin', page: PAGE });
      return;
    }

    /* Folders on the board carry data-k="f1".."f4" and a real href. Name the
       event after the target page, not the folder slot, so renumbering the fan
       doesn't rewrite history. */
    if (a.dataset.k && /^f\d+$/.test(a.dataset.k)) {
      var target = (a.getAttribute('href') || '').replace(/\.html$/, '');
      send('case_study_opened', { project: target });
    }
  });

  /* Reaching the end of a case study is the one engagement signal worth having:
     it separates "clicked a folder" from "actually read it". Depth rather than
     a sentinel element, so this works on every case study page without each of
     them needing a marker in the markup. Fires once. */
  if (isCaseStudy) {
    var done = false;
    window.addEventListener(
      'scroll',
      function () {
        if (done) return;
        var scrolled = window.scrollY + window.innerHeight;
        var height = document.documentElement.scrollHeight;
        if (height > 0 && scrolled / height >= 0.9) {
          done = true;
          send('case_study_read', { project: PAGE });
        }
      },
      { passive: true }
    );
  }
})();
