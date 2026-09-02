import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import type { BrowserFoundationOptions, PageSnapshot } from "../types.js"

export async function inspectUrl(options: BrowserFoundationOptions): Promise<PageSnapshot> {
  const solari = new Solari({ apiKey: options.apiKey })
  const browser = await solari.launch()
  const screenshotPath = path.resolve(options.runDir, "foundation.png")

  try {
    await mkdir(options.runDir, { recursive: true })
    const page = await browser.newPage()
    await page.goto(options.url)

    const snapshot: PageSnapshot = {
      url: page.url(),
      title: await page.title(),
      text: (await page.locator("body").innerText()).slice(0, 12_000),
      screenshotPath,
      sessionId: browser.id,
    }

    await page.screenshot({ path: screenshotPath, fullPage: true })
    return snapshot
  } finally {
    await browser.close()
    await solari.close()
  }
}