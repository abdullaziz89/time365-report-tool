// Ensures a Chromium/Chrome build is available locally.
// On first run it downloads it into a cache folder in the user's app data,
// matching the "setup downloads what it needs" requirement.

const { install, computeExecutablePath, detectBrowserPlatform, resolveBuildId, Browser } = require('@puppeteer/browsers');

// A known-good Chrome for Testing channel. "stable" resolves to the latest stable build.
const BROWSER = Browser.CHROME;
const BUILD_CHANNEL = 'stable';

/**
 * Make sure a browser is installed; download it on first run if missing.
 * @param {string} cacheDir  Writable directory to store the browser.
 * @param {(msg:string)=>void} onProgress  Progress callback.
 * @returns {Promise<string>} Absolute path to the browser executable.
 */
async function ensureBrowser(cacheDir, onProgress = () => {}) {
  const platform = detectBrowserPlatform();
  if (!platform) throw new Error('Unsupported platform for the browser download.');

  // Resolve the concrete build id for the stable channel.
  const buildId = await resolveBuildId(BROWSER, platform, BUILD_CHANNEL);

  // Is it already there?
  const executablePath = computeExecutablePath({ browser: BROWSER, buildId, cacheDir });
  const fs = require('fs');
  if (fs.existsSync(executablePath)) {
    return executablePath;
  }

  onProgress('Downloading the browser engine (first run only)…');
  let lastPct = -1;
  await install({
    browser: BROWSER,
    buildId,
    cacheDir,
    downloadProgressCallback: (downloaded, total) => {
      if (!total) return;
      const pct = Math.floor((downloaded / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        onProgress(`Downloading browser engine… ${pct}%`);
      }
    }
  });
  onProgress('Browser engine ready.');
  return computeExecutablePath({ browser: BROWSER, buildId, cacheDir });
}

module.exports = { ensureBrowser };
