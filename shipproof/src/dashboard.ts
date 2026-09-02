import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { runQAPipeline, type PipelineEvent } from "./orchestration/pipeline.js"
import type { RunState } from "./types.js"
import { loadShipProofEnv } from "./config/env.js"

await loadShipProofEnv()

const port = Number(process.env.DASHBOARD_PORT ?? 4174)
const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8")
const states = new Map<string, RunState>()
const controllers = new Map<string, AbortController>()
const subscribers = new Map<string, Set<ServerResponse>>()

function publish(runId: string, event: PipelineEvent | { eventType: string; runId: string; error?: string }) {
  for (const response of subscribers.get(runId) ?? []) response.write(`data: ${JSON.stringify(event)}\n\n`)
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost")
  if (request.method === "GET" && url.pathname === "/") return send(response, 200, html, "text/html; charset=utf-8")
  if (request.method === "GET" && url.pathname.startsWith("/api/runs/") && url.pathname.endsWith("/events")) return events(url, request, response)
  if (request.method === "GET" && url.pathname.startsWith("/api/runs/") && url.pathname.includes("/screenshots/")) return screenshot(url, response)
  if (request.method === "GET" && url.pathname.startsWith("/api/runs/")) {
    const state = states.get(url.pathname.split("/")[3]); return state ? send(response, 200, JSON.stringify(state), "application/json") : send(response, 404, JSON.stringify({ error: "Run not found" }), "application/json")
  }
  if (request.method === "POST" && url.pathname === "/api/runs") return startRun(request, response)
  if (request.method === "POST" && url.pathname.startsWith("/api/runs/") && url.pathname.endsWith("/stop")) {
    const runId = url.pathname.split("/")[3]; controllers.get(runId)?.abort(); return send(response, 202, JSON.stringify({ runId, status: "cancelling" }), "application/json")
  }
  return send(response, 404, "Not found", "text/plain")
}).listen(port, "127.0.0.1", () => console.log(`ShipProof dashboard: http://127.0.0.1:${port}`))

async function startRun(request: IncomingMessage, response: ServerResponse) {
  const body = await readBody(request); const target = typeof body.url === "string" ? body.url : ""
  try { new URL(target) } catch { return send(response, 400, JSON.stringify({ error: "A valid URL is required" }), "application/json") }
  const apiKey = process.env.SOLARI_API_KEY; const mistralKey = process.env.MISTRAL_API_KEY
  if (!apiKey || !mistralKey) return send(response, 503, JSON.stringify({ error: "SOLARI_API_KEY and MISTRAL_API_KEY are required" }), "application/json")
  const runId = `run-${randomUUID()}`; const controller = new AbortController(); controllers.set(runId, controller)
  const state: RunState = { runId, targetUrl: target, status: "queued", currentStep: 0, events: [], issues: [], reports: [], startedAt: new Date().toISOString() }; states.set(runId, state)
  if (!subscribers.has(runId)) subscribers.set(runId, new Set())
  send(response, 202, JSON.stringify({ runId }), "application/json")
  const runDir = path.resolve(process.env.SHIPPROOF_RUN_DIR ?? "./runs", runId)
  void runQAPipeline({ apiKey, mistralKey, url: target, runId, runDir, signal: controller.signal, onEvent: (event) => { state.status = "running"; state.currentStep = event.step; state.events.push(event as unknown as Record<string, unknown>); if (event.testId) state.currentTest = event.testId; if (event.issue) { state.issues.push(event.issue); state.reports.push(event.issue) } publish(runId, event) } })
    .then((finished) => { states.set(runId, finished); publish(runId, { eventType: "run_complete", runId }); controllers.delete(runId) })
    .catch((error) => { state.status = "failed"; state.error = error instanceof Error ? error.message : String(error); publish(runId, { eventType: "run_error", runId, error: state.error }); controllers.delete(runId) })
}

function events(url: URL, request: IncomingMessage, response: ServerResponse) { const runId = url.pathname.split("/")[3]; response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); if (!subscribers.has(runId)) subscribers.set(runId, new Set()); subscribers.get(runId)!.add(response); request.on("close", () => subscribers.get(runId)?.delete(response)) }
async function screenshot(url: URL, response: ServerResponse) { const runId = url.pathname.split("/")[3]; const name = path.basename(url.pathname.split("/screenshots/")[1]); if (name !== url.pathname.split("/screenshots/")[1]) return send(response, 400, "Invalid artifact", "text/plain"); const file = path.resolve(process.env.SHIPPROOF_RUN_DIR ?? "./runs", runId, "screenshots", name); try { await stat(file); return send(response, 200, await readFile(file), "image/png") } catch { return send(response, 404, "Artifact not found", "text/plain") } }
function send(response: ServerResponse, status: number, body: string | Buffer, type: string) { response.writeHead(status, { "content-type": type }); response.end(body) }
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> { const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> } catch { return {} } }
