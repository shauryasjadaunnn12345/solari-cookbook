import { mkdir } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import { validateAction, validateActionTarget, type QAAction } from "./actions.js"
import { ProgressTracker, actionTargetKey } from "./progress.js"

export interface AgentEvent {
  timestamp: string
  runId: string
  step: number
  eventType: "observe" | "plan" | "act" | "error" | "finish"
  action?: string
  url?: string
  result?: string
  durationMs?: number
  error?: string
}

export interface AgentObservation {
  url: string
  title: string
  text: string
  interactiveElements: Array<{ tag: string; role?: string; text: string; selector: string }>
  recentActions: string[]
  recentErrors: string[]
  screenshotReference?: string
  goal?: string
  test?: string
}

export interface ReasoningEngine {
  plan(observation: AgentObservation): Promise<unknown>
}

export interface AgentOptions {
  apiKey: string
  url: string
  runDir: string
  runId: string
  maxSteps?: number
  maxDurationMs?: number
  engine: ReasoningEngine
  onEvent?: (event: AgentEvent) => void
}

export interface ValidatedPlan {
  action?: QAAction
  finished: boolean
  decision?: unknown
  errors: string[]
}

export async function planValidatedAction(engine: ReasoningEngine, observation: AgentObservation, maxAttempts = 2, blockedActionKeys: string[] = [], validateTarget?: (action: QAAction) => Promise<void>): Promise<ValidatedPlan> {
  const errors: string[] = []
  let current = observation
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let decision: unknown
    try {
      decision = await engine.plan(current)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(message)
      current = { ...observation, recentErrors: [...observation.recentErrors, message].slice(-4) }
      continue
    }
    if (decision && typeof decision === "object" && "kind" in decision && (decision as { kind?: string }).kind === "finish") return { finished: true, decision, errors }
    const candidate = decision && typeof decision === "object" && "action" in decision ? (decision as { action: unknown }).action : decision
    try {
      const action = validateAction(candidate)
      if (blockedActionKeys.includes(actionTargetKey(action))) throw new Error(`Action ${actionTargetKey(action)} was blocked because the observation did not change; choose an untested relevant element or finish this test`)
      if (validateTarget) await validateTarget(action)
      return { action, finished: false, decision, errors }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(message)
      current = { ...observation, recentErrors: [...observation.recentErrors, message].slice(-4) }
    }
  }
  return { finished: false, errors }
}

export async function runAgent(options: AgentOptions): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  const emit = (event: AgentEvent) => {
    events.push(event)
    options.onEvent?.(event)
  }
  const started = Date.now()
  const maxSteps = options.maxSteps ?? 12
  const maxDurationMs = options.maxDurationMs ?? 90_000
  const solari = new Solari({ apiKey: options.apiKey })
  let browser: Awaited<ReturnType<Solari["launch"]>> | undefined

  try {
    browser = await solari.launch()
    await mkdir(path.join(options.runDir, "screenshots"), { recursive: true })
    const page = await browser.newPage()
    await page.goto(options.url)

    const recentActions: string[] = []
    const recentErrors: string[] = []
    const progress = new ProgressTracker()
    for (let step = 1; step <= maxSteps && Date.now() - started < maxDurationMs; step++) {
      const observation = await observe(page, recentActions, recentErrors, options.runDir, step)
      const unchangedObservations = progress.observe(observation)
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "observe", url: observation.url, result: observation.title })

      const planned = await planValidatedAction(options.engine, observation, 3, progress.blockedActionKeys(), (action) => validateActionTarget(page, action))
      for (const error of planned.errors) emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "error", error: `Invalid model action: ${error}; requesting a correction` })
      if (planned.finished) {
        emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "finish", result: "Reasoning engine finished the run" })
        break
      }
      if (!planned.action) {
        emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "error", error: "Model did not produce a supported action after recovery" })
        break
      }
      const action = planned.action
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "plan", action: action.name })
      if (unchangedObservations >= 2) {
        emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "finish", result: "Stopped after repeated action made no progress" })
        break
      }
      const actionStarted = Date.now()
      try {
        await executeAction(page, action, options.runDir, step)
        progress.recordAction(action)
        recentActions.push(action.name)
        if (recentActions.length > 6) recentActions.shift()
        emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "act", action: action.name, url: page.url(), durationMs: Date.now() - actionStarted })
      } catch (error) {
        recentErrors.push(error instanceof Error ? error.message : String(error))
        if (recentErrors.length > 4) recentErrors.shift()
        emit({ timestamp: new Date().toISOString(), runId: options.runId, step, eventType: "error", action: action.name, error: error instanceof Error ? error.message : String(error) })
        break
      }
    }
    return events
  } finally {
    if (browser) await browser.close()
    await solari.close()
  }
}

async function observe(page: any, recentActions: string[], recentErrors: string[], runDir: string, step: number): Promise<AgentObservation> {
  const elements = await page.locator("button, a, input, textarea, select, [role=button], [role=dialog]").evaluateAll((nodes: any[]) => nodes.slice(0, 40).map((node) => ({ tag: node.tagName.toLowerCase(), role: node.getAttribute("role") ?? undefined, text: (node.innerText || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").slice(0, 160), selector: node.id ? `#${node.id}` : node.tagName.toLowerCase() })))
  const screenshotReference = path.resolve(runDir, `screenshots/step-${step}.png`)
  await page.screenshot({ path: screenshotReference, fullPage: true })
  return { url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 8_000), interactiveElements: elements, recentActions: [...recentActions], recentErrors: [...recentErrors], screenshotReference }
}

async function executeAction(page: any, action: QAAction, runDir: string, step: number): Promise<void> {
  await validateActionTarget(page, action)
  switch (action.name) {
    case "navigate": await page.goto(action.url); break
    case "click": await page.locator(action.selector).click(); break
    case "type": await page.locator(action.selector).fill(action.text); break
    case "press_key": await page.keyboard.press(action.key); break
    case "take_screenshot": await page.screenshot({ path: path.resolve(runDir, `step-${step}.png`), fullPage: true }); break
    case "wait": await new Promise((resolve) => setTimeout(resolve, action.milliseconds)); break
    case "go_back": await page.goBack(); break
    case "reload": await page.reload(); break
    case "read_page": break
  }
}