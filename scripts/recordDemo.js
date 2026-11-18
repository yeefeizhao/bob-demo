/**
 * @file scripts/recordDemo.js
 * Uses Playwright to open the animated demo HTML page, wait for it to finish
 * playing, and save the recorded video to dist/demo-recording.webm.
 *
 * Usage:
 *   node scripts/recordDemo.js
 *
 * Requirements:
 *   npx playwright install chromium   (first-time only)
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const htmlPath = path.resolve(__dirname, '..', 'dist', 'demo-replay.html');
  const outDir   = path.resolve(__dirname, '..', 'dist');
  const videoDir = path.resolve(outDir, 'video-tmp');

  if (!fs.existsSync(htmlPath)) {
    console.error('dist/demo-replay.html not found. Run the transcript capture first.');
    process.exit(1);
  }

  if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

  console.log('Launching browser…');
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    viewport: { width: 960, height: 720 },
    recordVideo: {
      dir: videoDir,
      size: { width: 960, height: 720 },
    },
  });

  const page = await context.newPage();

  console.log('Opening demo-replay.html…');
  await page.goto('file://' + htmlPath);

  // The demo now has 30 events at ~500-1200 ms each ≈ ~28 s total.
  // Wait a generous 45 s to capture the full animation plus a tail pause.
  console.log('Recording animation (45 s)…');
  await page.waitForTimeout(45_000);

  // Extra pause at end so the final frame is readable
  await page.waitForTimeout(3_000);

  console.log('Closing browser and finalising video…');
  await context.close();
  await browser.close();

  // Playwright writes the video file to videoDir with a generated name.
  const videoFiles = fs.readdirSync(videoDir).filter((f) => f.endsWith('.webm'));
  if (videoFiles.length === 0) {
    console.error('No video file found in', videoDir);
    process.exit(1);
  }

  const videoSrc = path.join(videoDir, videoFiles[0]);
  const videoDst = path.join(outDir, 'demo-recording.webm');
  fs.renameSync(videoSrc, videoDst);
  fs.rmSync(videoDir, { recursive: true, force: true });

  const sizeMb = (fs.statSync(videoDst).size / 1024 / 1024).toFixed(1);
  console.log(`\nVideo saved: ${videoDst}  (${sizeMb} MB)`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('Recording failed:', err);
  process.exit(1);
});
