import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

const TOKEN_SINK_DIR = "e2e/.auth";

/**
 * Reads the raw magic-link URL for `email` from the test-only file sink
 * (`FileNotifier`, enabled by `E2E_TOKEN_SINK=1` — see
 * `src/core/notify/default.ts`) instead of the `notifications` table:
 * `notify()` redacts that table's payload for the `magic_link` kind, so
 * the raw token is never there to read. Polls briefly since the file is
 * written by a separate process (the app server).
 */
export async function latestMagicLinkUrl(email: string): Promise<string> {
  const file = path.join(TOKEN_SINK_DIR, `magic_link-${encodeURIComponent(email)}.json`);

  const deadline = Date.now() + 5000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const contents = await readFile(file, "utf8");
      return (JSON.parse(contents) as { url: string }).url;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`No magic-link token file found for ${email} at ${file}: ${String(lastError)}`);
}

/** Drives the real login form, then follows the magic link read from the database instead of a mailbox. */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByRole("status")).toContainText("Check your inbox");

  const url = await latestMagicLinkUrl(email);
  const path = new URL(url).pathname + new URL(url).search;
  await page.goto(path);
}

/** Relative luminance per WCAG, from an `rgb(r, g, b)` (or `rgba`) CSS colour string. */
function relativeLuminance(rgb: string): number {
  const match = rgb.match(/[\d.]+/g);
  if (!match) {
    throw new Error(`Could not parse colour: ${rgb}`);
  }
  const [r, g, b] = match.slice(0, 3).map(Number).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two `rgb()` CSS colour strings. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The accessible-ish text of the currently focused element, for
 * keyboard-navigation assertions. Returns "" for `<body>`/`<html>` (nothing
 * meaningfully focused yet) rather than their `textContent`, which is the
 * entire page's text and would match almost any search string immediately.
 */
export async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) {
      return "";
    }
    return el.textContent?.trim() ?? el.tagName;
  });
}

/** Presses Tab until the focused element's text contains `text`, or throws after `maxTabs`. */
export async function tabToText(page: Page, text: string, maxTabs = 40): Promise<void> {
  for (let i = 0; i < maxTabs; i += 1) {
    if ((await focusedText(page)).includes(text)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Could not reach a focusable element containing "${text}" within ${maxTabs} tabs`);
}

/**
 * Reads an element's computed text colour and its nearest non-transparent
 * background, for a WCAG contrast assertion. Tailwind v4's palette is
 * defined in OKLCH, and modern Chromium can report computed colours back
 * in `oklch(...)`/`color(...)` rather than `rgb(...)` — so both are
 * rasterized through a 1x1 canvas, which always reads back plain 0-255
 * sRGB bytes regardless of the input's colour function.
 */
export async function computedContrast(page: Page, selector: string): Promise<number> {
  const colours = await page.locator(selector).first().evaluate((element) => {
    function toRgbString(colour: string): string {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return `rgb(${r}, ${g}, ${b})`;
    }

    let node: Element | null = element;
    let backgroundColor = "rgba(0, 0, 0, 0)";
    while (node) {
      const style = getComputedStyle(node);
      if (style.backgroundColor && style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") {
        backgroundColor = style.backgroundColor;
        break;
      }
      node = node.parentElement;
    }
    return { color: toRgbString(getComputedStyle(element).color), backgroundColor: toRgbString(backgroundColor) };
  });
  return contrastRatio(colours.color, colours.backgroundColor);
}
