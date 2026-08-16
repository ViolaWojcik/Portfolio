/* analytics.js — conversion measurement, session replay and heatmaps.
 *
 * WHY THIS NOW LOADS POSTHOG'S LIBRARY
 * The previous version of this file was hand-written precisely to avoid that
 * library, and said so: "no autocapture, no session recording... if any of
 * those are ever wanted, this file gets deleted and the official snippet goes
 * in instead." Session replay and heatmaps were wanted. This is that trade,
 * made deliberately rather than by accident.
 *
 * What it costs, plainly: ~250KB of third-party JavaScript (~80KB over the
 * wire) on a site whose house rule in CLAUDE.md is "no external dependencies
 * beyond Google Fonts", and which gets audited with Lighthouse. It is loaded
 * async and never blocks paint, but it is not free. Recordings cannot be had
 * without it — the replay format is rrweb, which is the library.
 *
 * STILL NO COOKIES, SO STILL NO CONSENT BANNER
 * `persistence: 'sessionStorage'` keeps the property the old file was built
 * around: nothing is written to a cookie, nothing is shared across sites, and
 * nobody is followed between visits. PostHog defaults to cookies; that default
 * is overridden here on purpose. The cost is unchanged and still accepted —
 * a returning visitor counts as a new one.
 *
 * WHY THE NAMED EVENTS SURVIVED
 * Autocapture is on, which is what makes click maps useful. But autocapture
 * cannot know that this board is drag-and-drop: letting go of a dragged folder
 * fires a click, and autocapture will record it. The named events below keep
 * the drag guard and stay the honest source of truth for conversions.
 * Read `$autocapture` as texture, `cv_downloaded` as fact.
 */
(function () {
  'use strict';

  /* ---------- configuration ---------- */

  /* Project API key from PostHog → Project settings. Public by design: it can
     only write events, never read them. NOT the personal key ("phx_…"), which
     would hand over the whole account.
     Empty key = this whole file is a no-op, which is what you want while
     working on the site locally. */
  var KEY = 'phc_wbYZGRmnAzF5FrZyXT2dujFsWS8z2bWjD5mMMTawTCup';

  /* Must match the region the PostHog account was created in. EU accounts use
     the hosts below; a US account needs us.i.posthog.com / us-assets, or the
     events land nowhere, silently. Ingestion and the library come from
     different hosts on purpose — that is how PostHog serves the EU. */
  var HOST = 'https://eu.i.posthog.com';
  var ASSETS = 'https://eu-assets.i.posthog.com/static/array.js';

  if (!KEY) return;

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

  /* ---------- loading ----------
   *
   * The library arrives async, but visitors do not wait for it — someone can
   * click a folder before it lands. So events go into a queue from the first
   * millisecond and flush once PostHog is ready. Losing the earliest clicks
   * would bias the numbers towards slow connections, which is the opposite of
   * what we want to learn.
   *
   * If the script never loads (blocked, offline, ad blocker), the queue simply
   * never flushes. Nothing throws and nothing on the page notices. */
  var queue = [];
  var ready = false;

  function send(event, props) {
    if (!ready) {
      queue.push([event, props]);
      return;
    }
    try {
      window.posthog.capture(event, props);
    } catch (e) {
      /* analytics must never break the page */
    }
  }

  var script = document.createElement('script');
  script.src = ASSETS;
  script.async = true;

  script.onload = function () {
    try {
      window.posthog.init(KEY, {
        api_host: HOST,

        /* No cookies — see the header. */
        persistence: 'sessionStorage',

        /* The two things this rewrite exists for. */
        disable_session_recording: false,
        capture_heatmaps: true,

        /* Click maps need it; the named events below do not depend on it. */
        autocapture: true,

        /* Pageviews stay manual: the dashboards read `page` and `lang`, which
           an automatic pageview would not carry. */
        capture_pageview: false,

        /* The site has no real forms, but a recording that quietly captured
           typing would be a nasty surprise to discover later. */
        session_recording: { maskAllInputs: true },

        /* Nothing here asks questions. */
        disable_surveys: true
      });

      ready = true;
      for (var i = 0; i < queue.length; i++) send(queue[i][0], queue[i][1]);
      queue.length = 0;
    } catch (e) {
      /* analytics must never break the page */
    }
  };

  document.head.appendChild(script);

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
