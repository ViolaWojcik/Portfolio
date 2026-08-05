# wioletawojcik.com

A static portfolio: hand-written HTML, no framework, served by GitHub Pages from
the repository root (`CNAME` → `wioletawojcik.com`).

```
index.html                  the board — headline, polaroid, contact card, four folders
repapp.html                 Guest check-in · service design
red-thread.html             Red thread · service design concept
between-the-lines.html      Between the Lines · product design
hospital-wayfinding.html    Paths, not plans · service design
404.html                    served by Pages for any unknown path
robots.txt · sitemap.xml
tools/                      prerender + audit scripts (not published)
```

Each page is self-contained: its CSS, its JavaScript and its copy all live in the
one file. Nothing is bundled, and opening a file straight from disk works.

## Editing copy

Every page keeps both languages in a `T` object inside its own `<script>`. That
object is the source of truth — edit the text there, never in the markup.

**After editing `T` in any case study, re-run the prerender:**

```sh
npm install          # once
npm run prerender
```

### Why that step exists

The case studies paint themselves from `T` at load. Anything that does not run
JavaScript — LinkedIn and Slack link previews, Bing, Google's first HTML-only
pass — used to see about 120 characters per page and nothing else.

`npm run prerender` loads each page in real Chromium, takes the DOM that
JavaScript produced, and writes it back into the source file between
`<!--prerendered-->` markers. The page then ships complete in the HTML. When a
browser loads it, `render()` runs exactly as before and repaints the same markup
over the top, so the language switch and everything else behave identically —
the baked copy is a floor, not a replacement.

It is idempotent: run it twice and the second run reports "unchanged". If you
edit `T` and forget, the site still looks and works right in a browser; only
crawlers keep reading the previous text.

`index.html` is not prerendered. Its four folder titles are written into the
markup directly, which is all a crawler needs from the board.

## Checking your work

```sh
npm test          # 32 checks: mobile taps, desktop drag/click, keyboard, prerender, 404
npm run serve     # preview on a server shaped like GitHub Pages
npm run audit     # Lighthouse over all five pages
```

`npm test` emulates a phone as well as a desktop, and it checks that each control
is the topmost element **at the point a finger would land** — not merely that it
exists. That distinction is the whole point: the contact card once looked
perfect on mobile and was completely untappable.

`npm run serve` is worth using over opening the files directly: it is the only
way to see the two things Pages does and `file://` does not — extensionless URLs
(`/repapp` serves `repapp.html`) and the 404 page.

`npm run audit` writes full reports to `tools/reports/` and fails if
accessibility drops below 95 or SEO below 100 on any page. Both sit at 100 today;
keep them there.

If a sandbox or CI image already ships a Chromium, point the scripts at it with
`CHROMIUM_PATH=/path/to/chrome` instead of letting Playwright download its own.

## Things worth knowing before changing them

- **The folders are `<a href>` elements**, and the drag system is built around
  that: `pointerdown` ignores links nested *inside* an object but not the object
  itself, and the click handler calls `preventDefault()` only when a drag just
  ended. Turning them back into `<div>`s would cost the crawlable links,
  middle-click and "open in new tab".
- **The headline words start at `opacity:.01`, not `0`.** Chrome does not count
  anything at `opacity:0` as a contentful paint, so a board where every element
  begins fully transparent never fires First Contentful Paint at all — Lighthouse
  returns `NO_FCP` and cannot score the page.
- **Accessible names come from visible text.** The folders and the polaroid have
  no `aria-label`; their own copy names them, which is what keeps the name in
  step with the EN/NO switch. Adding an `aria-label` that does not contain the
  visible words breaks WCAG 2.5.3 and voice control with it.
- `--ink-mute` and `--accent` are set to clear 4.5:1 on all three surfaces. They
  have no headroom — darken, don't lighten.
- **The polaroid must stay positioned in the compact layout.** Its `::after` is
  a transparent click-catcher (`position:absolute; inset:0`) that exists because
  Chrome cannot hit-test the flipped face. An absolutely-positioned box resolves
  `inset:0` against its nearest *positioned* ancestor — so the moment the compact
  rule set `.obj{position:static}`, the overlay escaped to `#board` and spread a
  1548px invisible sheet over the whole stacked column instead of covering the
  321px photo. The folders survived on `z-index:3`; the contact card sits at
  `auto` and went completely dead. `npm test` guards this now.
