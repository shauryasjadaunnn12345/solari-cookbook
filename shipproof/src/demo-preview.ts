import { createDemoPreview } from "./sandbox/demo-preview.js"
import { loadShipProofEnv } from "./config/env.js"

await loadShipProofEnv()

const apiKey = process.env.SOLARI_API_KEY
if (!apiKey) {
  console.error("Missing SOLARI_API_KEY")
  process.exitCode = 1
} else {
  const preview = await createDemoPreview(apiKey)
  console.log(`ShipProof demo preview: ${preview.url}`)
  const close = async () => { await preview.close(); process.exit(0) }
  process.once("SIGINT", close)
  process.once("SIGTERM", close)
}
