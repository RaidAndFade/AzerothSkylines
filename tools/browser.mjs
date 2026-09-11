/**
 * Where to find Chromium for the development scripts.
 *
 * Set CHROMIUM_PATH when the browser lives somewhere Playwright will not
 * look by itself; otherwise Playwright's own installation is used.
 */
export function launchOptions() {
  const executablePath = process.env.CHROMIUM_PATH;
  return executablePath ? { executablePath } : {};
}
