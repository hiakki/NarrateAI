// Probe the project's gallery to count videos vs images and dump any video
// URLs that exist in the page DOM. Used to debug clip-detection failures.

import "dotenv/config";
import {
  launchBrowser,
  prepPage,
  dismissCookieWall,
  dismissWelcomeModal,
} from "../src/services/flow-tv-phase1";

const PROJECT_URL =
  "https://labs.google/fx/tools/flow/project/03e6b699-3901-4f21-8497-b0e75ca6a7c6";

async function main() {
  const browser = await launchBrowser();
  const page = await prepPage(browser);
  await page.goto(PROJECT_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookieWall(page);
  await dismissWelcomeModal(page).catch(() => false);
  await new Promise((r) => setTimeout(r, 4_000));

  // Scroll down to ensure all gallery tiles render.
  await page.evaluate(`(() => {
    window.scrollTo(0, document.body.scrollHeight);
  })()`);
  await new Promise((r) => setTimeout(r, 2_000));
  await page.evaluate(`(() => {
    window.scrollTo(0, 0);
  })()`);
  await new Promise((r) => setTimeout(r, 1_000));

  const probe = await page.evaluate(`(() => {
    const out = {
      url: location.href,
      videoElements: 0,
      videoSrcs: [],
      sourceSrcs: [],
      inputUrls: [],
      anchorsToVideo: [],
      tilesByLabel: [],
      veoErrorToasts: [],
    };

    document.querySelectorAll('video').forEach((v) => {
      out.videoElements++;
      if (v.src) out.videoSrcs.push(v.src);
      v.querySelectorAll('source').forEach((s) => {
        if (s.src) out.sourceSrcs.push(s.src);
      });
    });

    document.querySelectorAll('input').forEach((i) => {
      const val = i.value || '';
      if (val && /^https?:\\/\\//i.test(val)) {
        out.inputUrls.push(val.slice(0, 200));
      }
    });

    document.querySelectorAll('a').forEach((a) => {
      const href = a.href || '';
      if (/\\.(mp4|webm|m3u8)/i.test(href) || /video/i.test(href)) {
        out.anchorsToVideo.push(href.slice(0, 200));
      }
    });

    // Count tiles in the gallery and try to label as video vs image.
    const tiles = document.querySelectorAll('[role="button"], button, div');
    const seenSrcs = new Set();
    const candidates = [];
    tiles.forEach((t) => {
      const r = t.getBoundingClientRect();
      if (r.width < 150 || r.height < 100) return;
      // Only main gallery area (left of the prompt bar).
      const isGalleryTile = t.querySelector('img') && t.querySelector('img').src.length > 0;
      if (!isGalleryTile) return;
      const img = t.querySelector('img');
      const src = (img && img.src) || '';
      if (seenSrcs.has(src)) return;
      seenSrcs.add(src);
      const hasPlayIcon = (t.textContent || '').match(/play_arrow|^\\u25B6/i);
      candidates.push({
        text: (t.textContent || '').trim().slice(0, 60),
        hasVideoMark: !!hasPlayIcon,
        thumbSrc: src.slice(0, 120),
        rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      });
    });
    out.tilesByLabel = candidates.slice(0, 20);

    // Look for any "Generating", "Failed", "Insufficient", etc. toasts/text.
    const errKeywords = /generating|failed|insufficient|quota|denied|error|unable/i;
    document.querySelectorAll('[role="alert"], [class*="Toast"], [class*="Snackbar"], [class*="Notification"]').forEach((n) => {
      const t = (n.textContent || '').trim();
      if (t && errKeywords.test(t)) {
        out.veoErrorToasts.push(t.slice(0, 200));
      }
    });

    return out;
  })()`);

  console.log("=== PROJECT PROBE ===");
  console.log(JSON.stringify(probe, null, 2));

  await new Promise((r) => setTimeout(r, 3_000));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
