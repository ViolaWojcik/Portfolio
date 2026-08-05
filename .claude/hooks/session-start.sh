#!/bin/bash
#
# SessionStart hook — prepares a Claude Code on the web container so `npm test`,
# `npm run prerender` and `npm run audit` work without any manual setup.
#
# Two things stand between a fresh container and a green test run:
#
#   1. node_modules is absent (the repo ships only package.json + the lockfile).
#   2. Playwright wants to download its own Chromium, but the image already
#      ships one and the sandbox blocks the download. tools/browser.mjs reads
#      CHROMIUM_PATH for exactly this case (see README "Running the checks"),
#      so we find the pre-installed binary and export it.
#
# Local checkouts are left alone: there Playwright's own browser is the right
# one, and /opt/pw-browsers doesn't exist anyway.

set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# `install` rather than `ci`: the container image is cached after this hook
# finishes, so a warm node_modules makes it a near no-op on later sessions.
npm install --no-audit --no-fund

# Candidates in preference order. The bare `chromium` symlink is stable across
# image rebuilds; the glob catches an image that ever drops it, and the last two
# cover a system-packaged browser.
chromium=""
for candidate in \
  "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium" \
  "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"/chromium-*/chrome-linux/chrome \
  "$(command -v chromium 2>/dev/null || true)" \
  "$(command -v google-chrome 2>/dev/null || true)"
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    chromium="$candidate"
    break
  fi
done

if [ -n "$chromium" ]; then
  echo "export CHROMIUM_PATH=\"$chromium\"" >> "$CLAUDE_ENV_FILE"
  echo "session-start: node_modules ready; CHROMIUM_PATH=$chromium"
else
  # Not fatal — everything except the browser-driven scripts still works, and
  # saying so beats a confusing Playwright download error later.
  echo "session-start: node_modules ready; no pre-installed Chromium found," \
       "so npm test / prerender / audit may fail until one is available." >&2
fi
