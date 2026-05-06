// Probe: open the latest Flow TV project, find a video tile, right-click it,
// and dump every visible menu item. Helps diagnose why renameAssetTile fails
// for video tiles (different context-menu items? hover-only "more" button?).
//
// Usage:
//   npx tsx scripts/flow-tv-probe-video-rename.ts <projectUrl>

import "dotenv/config";
import { launchBrowser, prepPage, takeScreenshot } from "@/services/flow-tv-phase1";
import {
  findVideoTilesWithSrc,
  showAllMediaPanel,
} from "@/services/flow-tv-rename";
import path from "path";
import fs from "fs/promises";

async function main(): Promise<void> {
  const projectUrl = process.argv[2];
  if (!projectUrl) {
    console.error("Usage: tsx scripts/flow-tv-probe-video-rename.ts <projectUrl>");
    process.exit(2);
  }
  const dumpDir = path.join(
    process.cwd(),
    "data/flow-tv/probes/video-rename",
    String(Date.now()),
  );
  await fs.mkdir(dumpDir, { recursive: true });
  console.log(`Dump dir: ${dumpDir}`);

  const browser = await launchBrowser();
  const page = await prepPage(browser);
  try {
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(projectUrl, { waitUntil: "networkidle2", timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 3000));
    await showAllMediaPanel(page).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    await takeScreenshot(page, dumpDir, "01-loaded");

    const videos = await findVideoTilesWithSrc(page);
    console.log(`Found ${videos.length} video tiles`);
    if (videos.length === 0) {
      console.error("No video tiles — give a project that contains at least one Veo render.");
      process.exit(3);
    }
    const target = videos[0];
    console.log(`Targeting video at rect=`, target.rect, `src=${target.src.slice(0, 60)}…`);

    // Hover, scroll into view.
    await page.evaluate(
      (rect: { x: number; y: number; w: number; h: number }) => {
        window.scrollTo(0, Math.max(0, rect.y - 200));
      },
      target.rect,
    );
    await new Promise((r) => setTimeout(r, 500));
    const cx = target.rect.x + target.rect.w / 2;
    const cy = target.rect.y + target.rect.h / 2;
    await page.mouse.move(cx, cy);
    await new Promise((r) => setTimeout(r, 800));
    await takeScreenshot(page, dumpDir, "02-hovered");

    // STRATEGY A — right-click context menu.
    console.log("\n[A] Right-click context menu");
    await page.mouse.click(cx, cy, { button: "right" });
    await new Promise((r) => setTimeout(r, 1500));
    await takeScreenshot(page, dumpDir, "03-right-click-menu");

    const menuItems = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          "[role='menuitem'], [role='menu'] *, li[tabindex], div[tabindex='0']",
        ),
      );
      return items
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 30 || r.height < 14) return false;
          const cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") return false;
          return true;
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            text: ((el.innerText || el.textContent || "") + "")
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 80),
            tag: el.tagName,
            role: el.getAttribute("role") || "",
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })
        .slice(0, 30);
    });
    console.log("Right-click menu items:");
    for (const it of menuItems) console.log(`  ${it.tag}[${it.role}] @${it.x},${it.y} (${it.w}x${it.h}) "${it.text}"`);
    await fs.writeFile(path.join(dumpDir, "right-click-menu.json"), JSON.stringify(menuItems, null, 2));
    await page.keyboard.press("Escape").catch(() => {});
    await new Promise((r) => setTimeout(r, 600));

    // STRATEGY B — hover, find 3-dot / "more options" button on the tile.
    console.log("\n[B] Hover + find more-options button");
    await page.mouse.move(cx, cy);
    await new Promise((r) => setTimeout(r, 1000));
    await takeScreenshot(page, dumpDir, "04-hovered-stable");

    const moreButtons = await page.evaluate(
      (rect: { x: number; y: number; w: number; h: number }) => {
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const out: Array<{
          text: string;
          aria: string;
          tag: string;
          x: number;
          y: number;
          w: number;
          h: number;
          dist: number;
        }> = [];
        const els = Array.from(
          document.querySelectorAll<HTMLElement>(
            "button, [role='button'], [aria-label]",
          ),
        );
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 16 || r.height < 16 || r.width > 80 || r.height > 80) continue;
          const cs = window.getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const txt = ((el.innerText || el.textContent || "") + "").toLowerCase();
          const isMore =
            aria.includes("more") ||
            aria.includes("option") ||
            aria.includes("menu") ||
            txt === "more_vert" ||
            txt === "more_horiz" ||
            txt.includes("⋮") ||
            txt.includes("...");
          // Limit to within the tile rect (with some slack).
          const inside =
            r.x >= rect.x - 10 &&
            r.y >= rect.y - 10 &&
            r.x + r.width <= rect.x + rect.w + 10 &&
            r.y + r.height <= rect.y + rect.h + 10;
          if (!inside && !isMore) continue;
          const dx = Math.abs(cx - (r.x + r.width / 2));
          const dy = Math.abs(cy - (r.y + r.height / 2));
          out.push({
            text: txt.replace(/\s+/g, " ").slice(0, 40),
            aria: aria.slice(0, 60),
            tag: el.tagName,
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
            dist: Math.round(dx + dy),
          });
        }
        out.sort((a, b) => a.dist - b.dist);
        return out.slice(0, 20);
      },
      target.rect,
    );
    console.log("More-options candidates within/near tile:");
    for (const b of moreButtons) console.log(`  ${b.tag} @${b.x},${b.y} (${b.w}x${b.h}) dist=${b.dist} aria="${b.aria}" txt="${b.text}"`);
    await fs.writeFile(path.join(dumpDir, "more-options.json"), JSON.stringify(moreButtons, null, 2));

    // Click the more_vert button (if present) and dump the menu it opens.
    const moreBtn = moreButtons.find(
      (b) => b.text.includes("more_vert") || b.text.includes("more_horiz") || b.aria.includes("more"),
    );
    if (moreBtn) {
      console.log(`\n[B.2] Clicking more_vert at (${moreBtn.x + moreBtn.w / 2}, ${moreBtn.y + moreBtn.h / 2})`);
      await page.mouse.move(cx, cy);
      await new Promise((r) => setTimeout(r, 800));
      await page.mouse.click(
        moreBtn.x + moreBtn.w / 2,
        moreBtn.y + moreBtn.h / 2,
      );
      await new Promise((r) => setTimeout(r, 1500));
      await takeScreenshot(page, dumpDir, "07-more-vert-menu");
      const moreVertMenu = await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll<HTMLElement>(
            "[role='menuitem'], [role='menu'] *, li[tabindex], div[tabindex='0']",
          ),
        );
        return items
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 30 || r.height < 14) return false;
            const cs = window.getComputedStyle(el);
            if (cs.display === "none" || cs.visibility === "hidden") return false;
            return true;
          })
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              text: ((el.innerText || el.textContent || "") + "")
                .trim()
                .replace(/\s+/g, " ")
                .slice(0, 80),
              tag: el.tagName,
              role: el.getAttribute("role") || "",
              x: Math.round(r.x),
              y: Math.round(r.y),
              w: Math.round(r.width),
              h: Math.round(r.height),
            };
          })
          .slice(0, 40);
      });
      console.log("⋮ menu items:");
      for (const it of moreVertMenu) console.log(`  ${it.tag}[${it.role}] @${it.x},${it.y} "${it.text}"`);
      await fs.writeFile(path.join(dumpDir, "more-vert-menu.json"), JSON.stringify(moreVertMenu, null, 2));

      // Click Rename and dump where the input appears.
      const renameItem = moreVertMenu.find((m) => m.text.toLowerCase().includes("rename"));
      if (renameItem) {
        console.log(`\n[B.3] Clicking Rename @ ${renameItem.x},${renameItem.y}`);
        await page.mouse.click(
          renameItem.x + renameItem.w / 2,
          renameItem.y + renameItem.h / 2,
        );
        await new Promise((r) => setTimeout(r, 1500));
        await takeScreenshot(page, dumpDir, "08-rename-clicked");

        const inputs = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
          return all
            .map((i) => {
              const r = i.getBoundingClientRect();
              return {
                aria: i.getAttribute("aria-label") || "",
                value: i.value || "",
                placeholder: i.getAttribute("placeholder") || "",
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
              };
            })
            .filter((i) => i.w > 30 && i.h > 14);
        });
        console.log("Inputs visible after clicking Rename:");
        for (const ip of inputs)
          console.log(`  @${ip.x},${ip.y} (${ip.w}x${ip.h}) aria="${ip.aria}" ph="${ip.placeholder}" value="${ip.value.slice(0, 80)}"`);
        await fs.writeFile(path.join(dumpDir, "rename-inputs.json"), JSON.stringify(inputs, null, 2));
        await page.keyboard.press("Escape").catch(() => {});
      }
      await page.keyboard.press("Escape").catch(() => {});
    } else {
      console.log("\n[B.2] No more_vert button found within tile bounds");
    }

    // STRATEGY C — keyboard shortcut: F2 / Enter on the focused tile.
    console.log("\n[C] Keyboard: focus tile + F2 / Enter");
    await page.mouse.click(cx, cy); // try left-click to select
    await new Promise((r) => setTimeout(r, 800));
    await takeScreenshot(page, dumpDir, "05-after-left-click");
    await page.keyboard.press("F2").catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
    await takeScreenshot(page, dumpDir, "06-after-f2");
    const f2Inputs = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
      return inputs
        .filter((i) => {
          const r = i.getBoundingClientRect();
          return r.width > 30 && r.height > 14;
        })
        .map((i) => {
          const r = i.getBoundingClientRect();
          return {
            aria: (i.getAttribute("aria-label") || "").slice(0, 60),
            placeholder: (i.getAttribute("placeholder") || "").slice(0, 60),
            value: (i.value || "").slice(0, 80),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        });
    });
    console.log("Inputs after F2:");
    for (const ip of f2Inputs) console.log(`  @${ip.x},${ip.y} aria="${ip.aria}" ph="${ip.placeholder}" value="${ip.value}"`);
    await fs.writeFile(path.join(dumpDir, "f2-inputs.json"), JSON.stringify(f2Inputs, null, 2));
    await page.keyboard.press("Escape").catch(() => {});

    console.log(`\nDone. Dumps + screenshots in: ${dumpDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("[probe] fatal:", e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
