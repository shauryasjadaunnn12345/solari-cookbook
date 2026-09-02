import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Solari } from "@solarisdk/browser"
import { validateActionTarget, type QAAction } from "../agent/actions.js"
import { planValidatedAction } from "../agent/runner.js"
import { ProgressTracker, decideProgress } from "../agent/progress.js"
import { MistralProvider, type BugHypothesis, type TestPlanItem } from "../llm/mistral.js"
import { verifyInFreshSessions } from "../verification/proof-mode.js"
import { reportMarkdown } from "../reports/report.js"
import type { BugCategory, BugReport, RunState, Severity } from "../types.js"

export interface PipelineOptions { apiKey: string; mistralKey: string; url: string; runId: string; runDir: string; signal?: AbortSignal; maxSteps?: number; maxObservationsPerTest?: number; onEvent?: (event: PipelineEvent) => void }
export interface PipelineEvent { timestamp: string; runId: string; step: number; eventType: string; testId?: string; action?: string; rationale?: string; url?: string; result?: string; screenshotReference?: string; issue?: BugReport; error?: string }

export function shouldEnterProofMode(hypothesis: Pick<BugHypothesis, "isBug" | "needsVerification">): boolean {
  return hypothesis.isBug || hypothesis.needsVerification
}

export async function runQAPipeline(options: PipelineOptions): Promise<RunState> {
  const state: RunState = { runId: options.runId, targetUrl: options.url, status: "running", currentStep: 0, events: [], issues: [], reports: [], startedAt: new Date().toISOString() }
  const emit = (event: PipelineEvent) => { state.currentStep = event.step; state.events.push(event as unknown as Record<string, unknown>); options.onEvent?.(event) }
  const engine = new MistralProvider({ apiKey: options.mistralKey })
  let browser: Awaited<ReturnType<Solari["launch"]>> | undefined
  const solari = new Solari({ apiKey: options.apiKey })
  try {
    await mkdir(path.join(options.runDir, "screenshots"), { recursive: true })
    browser = await solari.launch()
    const page = await browser.newPage()
    await page.goto(options.url)
    const initial = await observe(page, options.runDir, 0)
    emit({ timestamp: new Date().toISOString(), runId: options.runId, step: 0, eventType: "observe", url: initial.url, result: initial.title, screenshotReference: initial.screenshotReference })
    const plan = await engine.planTests(initial)
    emit({ timestamp: new Date().toISOString(), runId: options.runId, step: 0, eventType: "test_plan", result: JSON.stringify(plan.tests.map(({ id, name, goal, priority }) => ({ id, name, goal, priority }))) })
    for (const test of plan.tests) {
      state.currentTest = test.name
      await executeTest(test, page, engine, options, state, emit)
      if (options.signal?.aborted) { state.status = "cancelled"; break }
    }
    if (state.status === "running") state.status = "completed"
    state.finishedAt = new Date().toISOString()
    await writeFile(path.join(options.runDir, "events.json"), JSON.stringify(state.events, null, 2))
    await writeFile(path.join(options.runDir, "metadata.json"), JSON.stringify(state, null, 2))
    for (const report of state.reports) await writeFile(path.join(options.runDir, `${report.id}.md`), reportMarkdown(report))
    return state
  } catch (error) {
    state.status = options.signal?.aborted ? "cancelled" : "failed"
    state.error = error instanceof Error ? error.message : String(error)
    state.finishedAt = new Date().toISOString()
    emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep, eventType: "error", error: state.error })
    return state
  } finally {
    if (browser) await browser.close()
    await solari.close()
  }
}

async function executeTest(test: TestPlanItem, page: any, engine: MistralProvider, options: PipelineOptions, state: RunState, emit: (event: PipelineEvent) => void) {
  const actions: QAAction[] = []
  const progress = new ProgressTracker()
  const maxSteps = options.maxSteps ?? 10
  const maxObservations = options.maxObservationsPerTest ?? maxSteps * 2
  let observationCount = 0
  for (let index = 1; index <= maxSteps; index++) {
    if (options.signal?.aborted) return
    if (observationCount >= maxObservations) {
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep, eventType: "observation_budget_exhausted", testId: test.id, result: `Reached the per-test observation budget of ${maxObservations}` })
      return
    }
    const observation = await observe(page, options.runDir, state.currentStep + 1)
    observationCount++
    const unchangedObservations = progress.observe(observation)
    if (unchangedObservations >= 2) {
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "no_progress", testId: test.id, result: "The page remained unchanged after bounded strategy changes; moving to the next test" })
      return
    }
    const planned = await planValidatedAction(engine, { ...observation, goal: test.goal, test: test.name }, 3, progress.blockedActionKeys(), (candidate) => validateActionTarget(page, candidate))
    for (const error of planned.errors) emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "error", testId: test.id, error: `Invalid model action: ${error}; requesting a correction` })
    if (planned.finished) return
    if (!planned.action) { emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "error", testId: test.id, error: "Model did not produce a supported action after recovery" }); return }
    const action = planned.action
    if (progress.shouldChangeStrategy(action)) {
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "no_progress", testId: test.id, action: action.name, result: "The proposed action did not change the observation" })
      return
    }
    const rationale = planned.decision && typeof planned.decision === "object" && "rationale" in planned.decision ? String((planned.decision as { rationale: unknown }).rationale) : undefined
    emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "act", testId: test.id, action: action.name, rationale, screenshotReference: observation.screenshotReference })
    await execute(page, action)
    actions.push(action)
    progress.recordAction(action)
    if (observationCount >= maxObservations) {
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "observation_budget_exhausted", testId: test.id, result: `Reached the per-test observation budget of ${maxObservations}` })
      return
    }
    const after = await observe(page, options.runDir, state.currentStep + 1)
    observationCount++
    const afterUnchanged = progress.observe(after)
    let hypothesis: BugHypothesis
    try {
      hypothesis = await engine.detectBug({ test, action, observation: after, previousObservation: observation })
    } catch (error) {
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "error", testId: test.id, error: error instanceof Error ? error.message : String(error) })
      return
    }
    const requiresProof = shouldEnterProofMode(hypothesis)
    emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: requiresProof ? "potential_bug" : "check", testId: test.id, result: hypothesis.reasoning, screenshotReference: after.screenshotReference })
    if (requiresProof) {
      if (decideProgress(afterUnchanged, true) !== "verify") return
      const report = await verifyAndReport(hypothesis, test, actions, options, engine, after.screenshotReference)
      state.issues.push(report); state.reports.push(report)
      emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep + 1, eventType: "bug_verified", testId: test.id, issue: report, result: `${report.verification.successfulAttempts}/${report.verification.attempts} reproductions` })
      return
    }
  }
  emit({ timestamp: new Date().toISOString(), runId: options.runId, step: state.currentStep, eventType: "action_budget_exhausted", testId: test.id, result: `Reached the per-test action budget of ${maxSteps}` })
}

async function verifyAndReport(hypothesis: BugHypothesis, test: TestPlanItem, actions: QAAction[], options: PipelineOptions, engine: MistralProvider, originalScreenshot: string | undefined): Promise<BugReport> {
  const verification = await verifyInFreshSessions(3, async (attempt) => {
    const solari = new Solari({ apiKey: options.apiKey }); let browser: Awaited<ReturnType<Solari["launch"]>> | undefined
    try { browser = await solari.launch(); const page = await browser.newPage(); await page.goto(options.url); for (const action of actions) await execute(page, action); const screenshot = path.join(options.runDir, "screenshots", `verification-${attempt}.png`); await page.screenshot({ path: screenshot, fullPage: true }); const result = await engine.verifyBug({ test, hypothesis, attempt, url: page.url(), screenshot }); return { reproduced: result.reproduced, evidence: [screenshot] } }
    finally { if (browser) await browser.close(); await solari.close() }
  })
  const id = `${String(hypothesis.category).slice(0, 4).toUpperCase()}-${Date.now().toString().slice(-5)}`
  return { id, title: hypothesis.title, severity: normalizeSeverity(hypothesis.severity), category: normalizeCategory(hypothesis.category), confidence: verification.confidence, status: verification.status, url: options.url, description: hypothesis.reasoning, expectedBehavior: hypothesis.expectedBehavior, actualBehavior: hypothesis.actualBehavior, reproductionSteps: actions.map((action) => JSON.stringify(action)), evidence: { screenshots: [originalScreenshot, ...verification.attempts.flatMap((attempt) => attempt.evidence ?? [])].filter((value): value is string => Boolean(value)), logs: [], errors: verification.attempts.flatMap((attempt) => attempt.error ? [attempt.error] : []) }, verification: { attempts: verification.attempts.length, successfulAttempts: verification.successfulAttempts }, severityReason: "Severity was assigned by the detection model and normalized to the supported report taxonomy.", timestamp: new Date().toISOString(), runId: options.runId }
}

async function observe(page: any, runDir: string, step: number) { const screenshotReference = path.resolve(runDir, "screenshots", `step-${step}.png`); await page.screenshot({ path: screenshotReference, fullPage: true }); return { url: page.url(), title: await page.title(), text: (await page.locator("body").innerText()).slice(0, 8_000), interactiveElements: await page.locator("button, a, input, textarea, select, [role=button], [role=dialog]").evaluateAll((nodes: any[]) => nodes.slice(0, 40).map((node) => ({ tag: node.tagName.toLowerCase(), role: node.getAttribute("role") ?? undefined, text: (node.innerText || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").slice(0, 160), selector: node.id ? `#${node.id}` : node.tagName.toLowerCase() }))), recentActions: [], recentErrors: [], screenshotReference } }
async function execute(page: any, action: QAAction) { await validateActionTarget(page, action); switch (action.name) { case "navigate": await page.goto(action.url); break; case "click": await page.locator(action.selector).click(); break; case "type": await page.locator(action.selector).fill(action.text); break; case "press_key": await page.keyboard.press(action.key); break; case "wait": await new Promise((resolve) => setTimeout(resolve, action.milliseconds)); break; case "go_back": await page.goBack(); break; case "reload": await page.reload(); break; case "take_screenshot": break; case "read_page": break } }
function normalizeSeverity(value: string): Severity { return (["critical", "high", "medium", "low", "informational"] as string[]).includes(value.toLowerCase()) ? value.toLowerCase() as Severity : "medium" }
function normalizeCategory(value: string): BugCategory { const categories: BugCategory[] = ["functional", "validation", "navigation", "authentication", "authorization", "ui", "performance", "error handling", "state management", "data integrity"]; return categories.includes(value.toLowerCase() as BugCategory) ? value.toLowerCase() as BugCategory : "functional" }