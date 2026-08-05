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
npm test          # 39 checks: mobile layout + taps, desktop drag/click, keyboard, prerender, 404
npm run serve     # preview on a server shaped like GitHub Pages
npm run audit     # Lighthouse over all five pages
npm run portrait  # rebuild the polaroid's WebP copies (only if the photo changes)
npm run fonts     # re-download the self-hosted webfonts (rarely needed)
npm run images    # re-encode case-study artwork as WebP (after adding or replacing any)
```

`npm test` emulates a phone as well as a desktop, and it asks two different
questions of the compact layout, because two different bugs have shipped past
one of them:

- **Can it be tapped?** Each control must be the topmost element *at the point a
  finger would land*, not merely present. The contact card once looked perfect
  and was completely untappable.
- **Does it look right?** Nothing in the stacked column may overlap anything
  else. The reverse case has also happened: every control tappable, the folder
  fan sitting on top of the polaroid's caption.

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
- **`my photo.png` has two jobs and only one of them is the polaroid.** The PNG
  is 1414×2000 and stays that big because Open Graph scrapers want a large
  image — `og:image` still points at it. The board draws the portrait at 182×212
  CSS px and reads the WebP copies instead, via `srcset`. Replace the photo and
  you must re-run `npm run portrait`, or the board keeps showing the old face.
- **The fonts are self-hosted, and their @font-face rules are generated.** They
  sit between `fonts:start` and `fonts:end` markers inside each page's `<style>`
  — `npm run fonts` writes them, so hand-edits there are lost on the next run.
  Only the `latin` and `latin-ext` subsets are downloaded: latin-ext is the one
  carrying ó, ł, ż for Polish and ø, å, æ for Norwegian, so it is not optional.
  Nothing is fetched from Google any more, which also keeps visitors' IPs off
  Google's logs.
- **The case-study artwork is served as WebP, generated from the originals.**
  The PNG/JPEG masters stay in `*/assets/` — deleting them would not shrink a
  clone anyway, and `og:image` still points at one of them on purpose, because
  link scrapers are less reliable about WebP than browsers are. The `ASSETS`
  entries in each page point at the `.webp`. Add or replace a master and run
  `npm run images`, then `npm run prerender` — the baked markup carries the
  image paths too, so skipping the second step leaves crawlers on stale URLs.
- **The polaroid must stay positioned in the compact layout.** Its `::after` is
  a transparent click-catcher (`position:absolute; inset:0`) that exists because
  Chrome cannot hit-test the flipped face. An absolutely-positioned box resolves
  `inset:0` against its nearest *positioned* ancestor — so the moment the compact
  rule set `.obj{position:static}`, the overlay escaped to `#board` and spread a
  1548px invisible sheet over the whole stacked column instead of covering the
  321px photo. The folders survived on `z-index:3`; the contact card sits at
  `auto` and went completely dead. `npm test` guards this now.
