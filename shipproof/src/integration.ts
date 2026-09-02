import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { runQAPipeline } from "./orchestration/pipeline.js"
import { analyzeArtifacts } from "./sandbox/artifacts.js"
import { loadShipProofEnv } from "./config/env.js"

await loadShipProofEnv()

const solariKey = process.env.SOLARI_API_KEY
const mistralKey = process.env.MISTRAL_API_KEY
const target = process.env.SHIPPROOF_TARGET_URL
const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`
const runDir = path.resolve(process.env.SHIPPROOF_RUN_DIR ?? "./runs", runId)

if (!solariKey || !mistralKey || !target) {
  console.error("Integration requires SOLARI_API_KEY, MISTRAL_API_KEY, and SHIPPROOF_TARGET_URL")
  process.exitCode = 1
} else {
  try {
    new URL(target)
    await mkdir(runDir, { recursive: true })
    const state = await runQAPipeline({ apiKey: solariKey, mistralKey, url: target, runDir, runId, onEvent: (event) => console.log(JSON.stringify(event)) })
    await writeFile(path.join(runDir, "events.json"), JSON.stringify(state.events, null, 2))
    console.log("sandbox:", await analyzeArtifacts(solariKey, runDir, JSON.stringify(state.events)))
  } catch (error) {
    console.error("ShipProof integration failed:", error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}