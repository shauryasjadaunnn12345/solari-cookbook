import { inspectUrl } from "./browser/foundation.js"
import { loadShipProofEnv } from "./config/env.js"

await loadShipProofEnv()

const url = process.argv[2]
const apiKey = process.env.SOLARI_API_KEY
const runDir = process.env.SHIPPROOF_RUN_DIR ?? "./runs/foundation"

if (!url) {
  console.error("Usage: npm start -- <url>")
  process.exitCode = 1
} else if (!apiKey) {
  console.error("Missing SOLARI_API_KEY")
  process.exitCode = 1
} else {
  try {
    const snapshot = await inspectUrl({ apiKey, url, runDir })
    console.log(JSON.stringify(snapshot, null, 2))
  } catch (error) {
    console.error("ShipProof foundation failed:", error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}