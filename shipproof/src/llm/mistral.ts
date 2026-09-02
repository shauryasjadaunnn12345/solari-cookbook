import { BROWSER_EXPLORATION_PROMPT, BUG_DETECTION_PROMPT, BUG_VERIFICATION_PROMPT, TEST_PLANNER_PROMPT } from "./prompts.js"
import type { AgentObservation, ReasoningEngine } from "../agent/runner.js"
import { validateAction } from "../agent/actions.js"

export interface MistralProviderOptions {
  apiKey: string
  model?: string
  endpoint?: string
  fetcher?: typeof fetch
  maxRetries?: number
  requestTimeoutMs?: number
  initialBackoffMs?: number
}
export interface MistralDecision { kind: "action" | "finish" | "continue" | "suspect"; rationale: string; action?: unknown; description?: string; reproduced?: boolean }
export interface TestPlanItem { id: string; name: string; goal: string; priority: "high" | "medium" | "low" }
export interface TestPlan { tests: TestPlanItem[] }
export interface BugHypothesis { isBug: boolean; needsVerification: boolean; title: string; category: string; severity: string; expectedBehavior: string; actualBehavior: string; reasoning: string }

const actionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "rationale", "name", "url", "selector", "text", "key", "milliseconds"],
  properties: {
    kind: { type: "string", enum: ["action", "finish"] },
    rationale: { type: "string" },
    name: { type: ["string", "null"], enum: ["navigate", "click", "type", "press_key", "read_page", "take_screenshot", "wait", "go_back", "reload", null] },
    url: { type: ["string", "null"] },
    selector: { type: ["string", "null"] },
    text: { type: ["string", "null"] },
    key: { type: ["string", "null"] },
    milliseconds: { type: ["number", "null"] },
  },
} as const

const testPlanSchema = { type: "object", additionalProperties: false, required: ["tests"], properties: { tests: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["id", "name", "goal", "priority"], properties: { id: { type: "string" }, name: { type: "string" }, goal: { type: "string" }, priority: { type: "string", enum: ["high", "medium", "low"] } } } } } } as const
const bugSchema = { type: "object", additionalProperties: false, required: ["isBug", "needsVerification", "title", "category", "severity", "expectedBehavior", "actualBehavior", "reasoning"], properties: { isBug: { type: "boolean" }, needsVerification: { type: "boolean" }, title: { type: "string" }, category: { type: "string" }, severity: { type: "string" }, expectedBehavior: { type: "string" }, actualBehavior: { type: "string" }, reasoning: { type: "string" } } } as const
const verificationSchema = { type: "object", additionalProperties: false, required: ["reproduced", "rationale"], properties: { reproduced: { type: "boolean" }, rationale: { type: "string" } } } as const

export function parseMistralDecision(value: unknown): MistralDecision {
  if (!value || typeof value !== "object") throw new Error("Mistral response must be an object")
  const decision = value as Record<string, unknown>
  if (!["action", "finish", "continue", "suspect"].includes(String(decision.kind))) throw new Error("Mistral response has an invalid decision kind")
  if (typeof decision.rationale !== "string" || decision.rationale.length > 2_000) throw new Error("Mistral response requires a concise rationale")
  if (decision.kind === "action") {
    if (typeof decision.name !== "string") throw new Error("Mistral action decision is missing name")
    const action = { name: decision.name, url: decision.url, selector: decision.selector, text: decision.text, key: decision.key, milliseconds: decision.milliseconds }
    return { kind: "action", rationale: decision.rationale, action: validateAction(removeNullFields(action)) }
  }
  return { kind: decision.kind as "finish", rationale: decision.rationale }
}

function removeNullFields(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== null && field !== undefined))
}

export function parseTestPlan(value: unknown): TestPlan {
  if (!value || typeof value !== "object" || !Array.isArray((value as { tests?: unknown }).tests)) throw new Error("Mistral test plan must contain tests")
  const tests = (value as { tests: unknown[] }).tests.slice(0, 5).map((item) => {
    if (!item || typeof item !== "object") throw new Error("Mistral test plan contains an invalid test")
    const test = item as Record<string, unknown>
    if (!["high", "medium", "low"].includes(String(test.priority)) || ["id", "name", "goal"].some((key) => typeof test[key] !== "string")) throw new Error("Mistral test plan contains incomplete test data")
    return { id: test.id as string, name: test.name as string, goal: test.goal as string, priority: test.priority as TestPlanItem["priority"] }
  })
  return { tests }
}

export function parseBugHypothesis(value: unknown): BugHypothesis {
  if (!value || typeof value !== "object") throw new Error("Mistral bug response must be an object")
  const bug = value as Record<string, unknown>
  const fields = ["title", "category", "severity", "expectedBehavior", "actualBehavior", "reasoning"]
  if (typeof bug.isBug !== "boolean" || typeof bug.needsVerification !== "boolean" || fields.some((field) => typeof bug[field] !== "string")) throw new Error("Mistral bug response is incomplete")
  return bug as unknown as BugHypothesis
}

export class MistralProvider implements ReasoningEngine {
  private readonly fetcher: typeof fetch
  private readonly endpoint: string
  private readonly model: string
  private readonly maxRetries: number
  private readonly requestTimeoutMs: number
  private readonly initialBackoffMs: number
  constructor(private readonly options: MistralProviderOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.endpoint = options.endpoint ?? "https://api.mistral.ai/v1/chat/completions"
    this.model = options.model ?? process.env.MISTRAL_MODEL ?? "mistral-large-latest"
    this.maxRetries = clampInteger(options.maxRetries ?? 2, 0, 5)
    this.requestTimeoutMs = clampInteger(options.requestTimeoutMs ?? 15_000, 1_000, 60_000)
    this.initialBackoffMs = clampInteger(options.initialBackoffMs ?? 250, 0, 1_000)
  }
  async plan(observation: AgentObservation): Promise<unknown> { return this.request(BROWSER_EXPLORATION_PROMPT, observation, parseMistralDecision, "plan", "browser_action", actionSchema) }
  async planTests(observation: AgentObservation): Promise<TestPlan> { return this.request(TEST_PLANNER_PROMPT, observation, parseTestPlan, "planTests", "test_plan", testPlanSchema) }
  async detectBug(input: unknown): Promise<BugHypothesis> { return this.request(BUG_DETECTION_PROMPT, input, parseBugHypothesis, "detectBug", "bug_hypothesis", bugSchema) }
  async verifyBug(input: unknown): Promise<{ reproduced: boolean; rationale: string }> {
    return this.request(BUG_VERIFICATION_PROMPT, input, (value) => {
      if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).reproduced !== "boolean" || typeof (value as Record<string, unknown>).rationale !== "string") throw new Error("Mistral verification response is incomplete")
      return value as { reproduced: boolean; rationale: string }
    }, "verifyBug", "bug_verification", verificationSchema)
  }
  private async request<T>(system: string, input: unknown, parse: (value: unknown) => T, operation: string, schemaName: string, schema: object): Promise<T> {
    let correction = ""
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const body = JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: `${JSON.stringify(input)}${correction}` }], response_format: { type: "json_schema", json_schema: { name: schemaName, schema, strict: true } } })
      const response = await this.fetcher(this.endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` }, body, signal: AbortSignal.timeout(this.requestTimeoutMs) })
      if (response.ok) {
        const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
        const content = payload.choices?.[0]?.message?.content
        if (typeof content !== "string") throw new Error("Mistral response did not contain message content")
        try { return parse(JSON.parse(content)) } catch (error) {
          const message = error instanceof Error ? error.message : "Mistral returned malformed JSON"
          if (attempt === this.maxRetries) throw new Error(`${message} after ${attempt + 1} response attempt${attempt === 0 ? "" : "s"}`)
          correction = `\n\nCORRECTION REQUIRED: The previous response failed validation (${message}). Return a complete response matching the JSON schema; do not omit required fields or add defaults.`
          continue
        }
      }
      if (response.status === 403) throw new Error("Mistral rejected the request with HTTP 403; verify the API key has access to the configured model")
      if (!isTransientStatus(response.status)) {
        await reportMistralError(response, operation, this.model)
        throw new Error(`Mistral request failed with HTTP ${response.status} after ${attempt + 1} attempt${attempt === 0 ? "" : "s"}`)
      }
      if (!isTransientStatus(response.status) || attempt === this.maxRetries) throw new Error(`Mistral request failed with HTTP ${response.status} after ${attempt + 1} attempt${attempt === 0 ? "" : "s"}`)
      await delay(Math.min(this.initialBackoffMs * 2 ** attempt, 1_000))
    }
    throw new Error("Mistral request did not complete")
  }
}

function isTransientStatus(status: number): boolean {
  return [429, 500, 502, 503, 504].includes(status)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Math.trunc(value), minimum), maximum)
}

async function reportMistralError(response: Response, operation: string, model: string): Promise<void> {
  if (process.env.SHIPPROOF_MISTRAL_DIAGNOSTICS !== "1") return
  let detail = ""
  try {
    const payload = await response.clone().json() as { message?: unknown; code?: unknown; type?: unknown; error?: { message?: unknown; code?: unknown; type?: unknown } }
    const error = payload.error ?? payload
    const fields = ["message", "code", "type"]
    detail = fields.map((field) => `${field}=${typeof error[field as keyof typeof error] === "string" ? error[field as keyof typeof error] : "unknown"}`).join(" ")
  } catch {
    detail = "message=unavailable code=unavailable type=unavailable"
  }
  console.error(`[Mistral] operation=${operation} model=${model} status=${response.status} ${detail}`)
}
