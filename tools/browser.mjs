/**
 * One place to open Chromium, shared by the prerender and the audit.
 *
 * Normally Playwright uses the browser it downloaded itself (`npx playwright
 * install chromium`, once). Set CHROMIUM_PATH to point at an existing binary
 * instead — useful in CI images and sandboxes that ship a browser already and
 * would rather not download a second copy.
 */

import { chromium } from 'playwright';

export function launchChromium(options = {}) {
  const executablePath = process.env.CHROMIUM_PATH;
  return chromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) });
}
