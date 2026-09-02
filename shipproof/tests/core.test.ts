import assert from "node:assert/strict"
import test from "node:test"
import { validateAction, validateActionTarget } from "../src/agent/actions.js"
import { reportMarkdown } from "../src/reports/report.js"
import { confidenceScore, verificationStatus } from "../src/verification/confidence.js"
import { verifyInFreshSessions } from "../src/verification/proof-mode.js"
import { planValidatedAction, type AgentObservation } from "../src/agent/runner.js"
import { ProgressTracker, actionTargetKey, decideProgress, observationFingerprint } from "../src/agent/progress.js"
import { shouldEnterProofMode } from "../src/orchestration/pipeline.js"
import type { BugReport } from "../src/types.js"
import { MistralProvider, parseBugHypothesis, parseMistralDecision, parseTestPlan } from "../src/llm/mistral.js"

test("confidence and verification require repeated reproduction", () => {
  assert.equal(confidenceScore(3, 3), 100)
  assert.equal(confidenceScore(3, 1), 33)
  assert.equal(verificationStatus(3, 1), "unconfirmed")
  assert.equal(verificationStatus(3, 2), "verified")
})

test("action validation rejects unsafe or malformed actions", () => {
  assert.deepEqual(validateAction({ name: "click", selector: "button[type=submit]" }), {
    name: "click",
    selector: "button[type=submit]",
  })
  assert.throws(() => validateAction({ name: "type", selector: "#password", text: "x".repeat(2_001) }))
  assert.throws(() => validateAction({ name: "press_key", key: "Meta" }))
  assert.throws(() => validateAction({ name: "type", text: "hello" }))
  assert.throws(() => validateAction({ name: "type", selector: "#email" }))
  assert.deepEqual(validateAction({ name: "type", selector: "#email", text: "hello" }), { name: "type", selector: "#email", text: "hello" })
})

test("report markdown contains evidence and reproduction details", () => {
  const report: BugReport = {
    id: "AUTH-001",
    title: "Invalid credentials accepted",
    severity: "high",
    category: "authentication",
    confidence: 100,
    status: "verified",
    url: "http://localhost:3000/login",
    description: "The login flow grants access for invalid credentials.",
    expectedBehavior: "An error should be shown.",
    actualBehavior: "The dashboard is displayed.",
    reproductionSteps: ["Open /login", "Submit invalid credentials"],
    evidence: { screenshots: ["screenshots/auth.png"], logs: [], errors: [] },
    verification: { attempts: 3, successfulAttempts: 3 },
    severityReason: "Authentication is bypassed.",
    timestamp: new Date(0).toISOString(),
    runId: "run-001",
  }
  const markdown = reportMarkdown(report)
  assert.match(markdown, /AUTH-001/)
  assert.match(markdown, /screenshots\/auth\.png/)
  assert.match(markdown, /2\. Submit invalid credentials/)
})

test("Proof Mode repeats reproduction and records failed attempts", async () => {
  const result = await verifyInFreshSessions(3, async (attempt) => ({
    reproduced: attempt !== 2,
    evidence: [`attempt-${attempt}.png`],
  }))
  assert.equal(result.successfulAttempts, 2)
  assert.equal(result.confidence, 67)
  assert.equal(result.status, "verified")
  assert.equal(result.attempts[1].reproduced, false)
})

test("Mistral decisions are parsed and malformed responses are rejected", async () => {
  assert.deepEqual(parseMistralDecision({ kind: "action", rationale: "Read the page", name: "read_page", url: null, selector: null, text: null, key: null, milliseconds: null }), { kind: "action", rationale: "Read the page", action: { name: "read_page" } })
  assert.throws(() => parseMistralDecision({ kind: "action", rationale: "missing action" }))
  assert.throws(() => parseMistralDecision({ kind: "action", rationale: "x", action: { name: "run_shell" } }))

  const provider = new MistralProvider({
    apiKey: "test-key",
    fetcher: async (input, init) => {
      assert.equal(input, "https://api.mistral.ai/v1/chat/completions")
      assert.equal(init?.method, "POST")
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-key")
      const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ role: string; content: string }>; response_format: { type: string; json_schema: { schema: { required: string[] } } } }
      assert.equal(body.model, "mistral-large-latest")
      assert.equal(body.messages[0].role, "system")
      assert.equal(body.messages[1].role, "user")
      assert.equal(body.response_format.type, "json_schema")
      assert.ok(body.response_format.json_schema.schema.required.includes("name"))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "finish", rationale: "No safe test remains", name: null, url: null, selector: null, text: null, key: null, milliseconds: null }) } }] }), { status: 200 })
    },
  })
  const decision = await provider.plan({ url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] })
  assert.equal((decision as { kind: string }).kind, "finish")
  assert.equal(parseTestPlan({ tests: [{ id: "login", name: "Login validation", goal: "Reject invalid credentials", priority: "high" }] }).tests.length, 1)
  assert.throws(() => parseTestPlan({ tests: [{ id: "bad" }] }))
  assert.equal(parseBugHypothesis({ isBug: false, needsVerification: false, title: "", category: "functional", severity: "low", expectedBehavior: "", actualBehavior: "", reasoning: "No issue" }).isBug, false)
})

test("Mistral retries a transient 504 and succeeds", async () => {
  let calls = 0
  const provider = new MistralProvider({
    apiKey: "test-key",
    maxRetries: 2,
    initialBackoffMs: 0,
    requestTimeoutMs: 1_000,
    fetcher: async (_input, init) => {
      calls++
      assert.ok(init?.signal instanceof AbortSignal)
      if (calls < 2) return new Response("upstream unavailable", { status: 504 })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "finish", rationale: "Done" }) } }] }), { status: 200 })
    },
  })
  const result = await provider.plan({ url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] })
  assert.equal((result as { kind: string }).kind, "finish")
  assert.equal(calls, 2)
})

test("Mistral reports exhausted transient retries without exposing a response body", async () => {
  let calls = 0
  const provider = new MistralProvider({ apiKey: "test-key", maxRetries: 2, initialBackoffMs: 0, fetcher: async () => { calls++; return new Response("private upstream details", { status: 504 }) } })
  await assert.rejects(() => provider.plan({ url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] }), /HTTP 504 after 3 attempts/)
  assert.equal(calls, 3)
})

test("Mistral does not retry a 403", async () => {
  let calls = 0
  const provider = new MistralProvider({ apiKey: "test-key", maxRetries: 2, initialBackoffMs: 0, fetcher: async () => { calls++; return new Response("private auth details", { status: 403 }) } })
  await assert.rejects(() => provider.plan({ url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] }), /HTTP 403/)
  assert.equal(calls, 1)
})

test("unsupported model action recovers with a supported action", async () => {
  const observations: AgentObservation[] = []
  const result = await planValidatedAction({
    plan: async (observation) => {
      observations.push(observation)
      if (observations.length === 1) return { kind: "action", rationale: "Submit the form", action: { name: "submit_form" } }
      return { kind: "action", rationale: "Click the form submit button", action: { name: "click", selector: "button[type=submit]" } }
    },
  }, { url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] })
  assert.equal(result.action?.name, "click")
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /Unsupported action: submit_form/)
  assert.match(observations[1].recentErrors[0], /submit_form/)
})

test("Mistral schema requires complete type actions and retries incomplete responses", async () => {
  let calls = 0
  const provider = new MistralProvider({ apiKey: "test-key", maxRetries: 1, initialBackoffMs: 0, fetcher: async (_input, init) => {
    calls++
    const body = JSON.parse(String(init?.body)) as { response_format: { json_schema: { schema: { required: string[] } } }; messages: Array<{ content: string }> }
    assert.deepEqual(body.response_format.json_schema.schema.required, ["kind", "rationale", "name", "url", "selector", "text", "key", "milliseconds"])
    if (calls === 1) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "action", rationale: "Type", name: "type", url: null, selector: "#email", text: null, key: null, milliseconds: null }) } }] }), { status: 200 })
    assert.match(body.messages[1].content, /CORRECTION REQUIRED/)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ kind: "action", rationale: "Type email", name: "type", url: null, selector: "#email", text: "qa@example.com", key: null, milliseconds: null }) } }] }), { status: 200 })
  } })
  const result = await provider.plan({ url: "https://example.com", title: "Example", text: "", interactiveElements: [], recentActions: [], recentErrors: [] })
  assert.deepEqual(result, { kind: "action", rationale: "Type email", action: { name: "type", selector: "#email", text: "qa@example.com" } })
  assert.equal(calls, 2)
})

test("Mistral retries an incomplete bug response and fails safely when still incomplete", async () => {
  let calls = 0
  const provider = new MistralProvider({ apiKey: "test-key", maxRetries: 1, initialBackoffMs: 0, fetcher: async () => {
    calls++
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ isBug: true, needsVerification: true, title: "Incomplete" }) } }] }), { status: 200 })
  } })
  await assert.rejects(() => provider.detectBug({ observation: "test" }), /Mistral bug response is incomplete after 2 response attempts/)
  assert.equal(calls, 2)
})

const progressObservation: AgentObservation = { url: "https://example.com", title: "Example", text: "Stable page", interactiveElements: [{ tag: "button", text: "Next", selector: "#next" }], recentActions: [], recentErrors: [] }

test("repeated identical read_page observations are detected without becoming proof", () => {
  const tracker = new ProgressTracker()
  assert.equal(tracker.observe(progressObservation), 0)
  tracker.recordAction({ name: "read_page" })
  assert.equal(tracker.observe({ ...progressObservation }), 1)
  assert.equal(tracker.shouldChangeStrategy({ name: "read_page" }), true)
  assert.equal(decideProgress(1, false), "change_strategy")
  assert.equal(decideProgress(1, true), "verify")
})

test("progress controller preserves a stable fingerprint and action budget", () => {
  const tracker = new ProgressTracker()
  assert.equal(observationFingerprint(progressObservation), observationFingerprint({ ...progressObservation }))
  tracker.recordAction({ name: "click", selector: "#next" })
  tracker.recordAction({ name: "click", selector: "#next" })
  assert.equal(tracker.actionCount("click:#next"), 2)
  assert.equal(actionTargetKey({ name: "click", selector: "#other" }), "click:#other")
})

test("different click targets remain available after one target makes no progress", async () => {
  const tracker = new ProgressTracker()
  tracker.observe(progressObservation)
  tracker.recordAction({ name: "click", selector: "#createWorkspace" })
  tracker.observe({ ...progressObservation })
  const result = await planValidatedAction({ plan: async () => ({ name: "click", selector: "#openWorkspace" }) }, progressObservation, 1, tracker.blockedActionKeys())
  assert.equal(result.action?.selector, "#openWorkspace")
})

test("the same click target is bounded after an unchanged result", async () => {
  const tracker = new ProgressTracker()
  tracker.observe(progressObservation)
  tracker.recordAction({ name: "click", selector: "#openWorkspace" })
  tracker.observe({ ...progressObservation })
  const result = await planValidatedAction({ plan: async () => ({ name: "click", selector: "#openWorkspace" }) }, progressObservation, 2, tracker.blockedActionKeys())
  assert.equal(result.action, undefined)
  assert.equal(result.errors.length, 2)
  assert.match(result.errors[0], /click:#openWorkspace/)
})

test("timeout during planning is recoverable on the next bounded attempt", async () => {
  let calls = 0
  const result = await planValidatedAction({ plan: async () => { calls++; if (calls === 1) throw new DOMException("request timed out", "TimeoutError"); return { name: "click", selector: "#next" } } }, progressObservation, 2)
  assert.equal(result.action?.name, "click")
  assert.equal(result.errors[0], "request timed out")
  assert.equal(calls, 2)
})

function pageForMatches(count: number, candidates: unknown[] = []) {
  return { locator: (_selector: string) => ({ count: async () => count, evaluateAll: async (_callback: unknown) => candidates }) }
}

test("unique click selector is allowed and role/name selectors can be exact", async () => {
  await validateActionTarget(pageForMatches(1), { name: "click", selector: "#createWorkspace" })
  await validateActionTarget(pageForMatches(1), { name: "click", selector: "role=button[name='Create workspace']" })
})

test("broad or ambiguous click selectors are rejected with candidates", async () => {
  await assert.rejects(() => validateActionTarget(pageForMatches(4, [
    { tag: "button", id: "signIn", text: "Sign in" },
    { tag: "button", id: "createWorkspace", text: "Create workspace" },
  ]), { name: "click", selector: "button" }), /ambiguous: matched 4.*createWorkspace/)
  await assert.rejects(() => validateActionTarget(pageForMatches(1), { name: "click", selector: "button" }), /too broad/)
})

test("zero-match click selectors are recoverable planning errors", async () => {
  await assert.rejects(() => validateActionTarget(pageForMatches(0), { name: "click", selector: "#missing" }), /matched no actionable elements/)
})

test("ambiguous click is replanned to a unique target instead of clicking arbitrarily", async () => {
  const page = { locator: (selector: string) => selector === "button" ? { count: async () => 4, evaluateAll: async () => [] } : { count: async () => 1, evaluateAll: async () => [] } }
  let calls = 0
  const result = await planValidatedAction({ plan: async () => { calls++; return calls === 1 ? { name: "click", selector: "button" } : { name: "click", selector: "#openWorkspace" } } }, progressObservation, 2, [], (action) => validateActionTarget(page, action))
  assert.equal(result.action?.selector, "#openWorkspace")
  assert.equal(calls, 2)
  assert.match(result.errors[0], /ambiguous: matched 4/)
})

test("a cautious suspicious check enters Proof Mode without treating it as verified", () => {
  assert.equal(shouldEnterProofMode({ isBug: false, needsVerification: true }), true)
  assert.equal(shouldEnterProofMode({ isBug: false, needsVerification: false }), false)
  assert.equal(shouldEnterProofMode({ isBug: true, needsVerification: false }), true)
})

test("unrelated stale text does not create a proof transition", () => {
  const staleText = "Workspace route failed to load"
  const hypothesis = { isBug: false, needsVerification: false, title: "", category: "functional", severity: "low", expectedBehavior: staleText, actualBehavior: staleText, reasoning: "The current usage observation is unchanged, but no causal defect was established." }
  assert.equal(shouldEnterProofMode(hypothesis), false)
})