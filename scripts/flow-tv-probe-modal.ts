// Probe what the bottom-bar chip's textContent actually is.

import "dotenv/config";
import { launchBrowser, prepPage, dismissCookieWall } from "../src/services/flow-tv-phase1";

const PROJECT_URL =
  "https://labs.google/fx/tools/flow/project/03e6b699-3901-4f21-8497-b0e75ca6a7c6";

async function main() {
  const browser = await launchBrowser();
  const page = await prepPage(browser);
  await page.goto(PROJECT_URL, { waitUntil: "networkidle2", timeout: 60_000 });
  await dismissCookieWall(page);
  await new Promise((r) => setTimeout(r, 3_000));

  const probe = await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
    const candidates = btns.filter((b) => {
      const r = b.getBoundingClientRect();
      // Bottom area only
      return r.top > 400 && r.height > 0 && r.width > 0;
    }).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: (b.textContent || '').trim(),
        rect: { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        cls: (b.className && b.className.toString) ? b.className.toString().slice(0, 80) : '',
      };
    }).filter((c) => c.text.length > 0 && c.text.length < 80);
    return { url: location.href, candidates };
  })()`);
  console.log("=== BOTTOM BUTTONS ===");
  console.log(JSON.stringify(probe, null, 2));

  // Also dump page title (project rename target check)
  const title = await page.evaluate(`(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.map((i) => ({ value: i.value, type: i.type, placeholder: i.placeholder, ariaLabel: i.getAttribute('aria-label') })).filter((i) => i.value || i.placeholder);
  })()`);
  console.log("=== INPUTS ===");
  console.log(JSON.stringify(title, null, 2));

  await new Promise((r) => setTimeout(r, 2_000));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
