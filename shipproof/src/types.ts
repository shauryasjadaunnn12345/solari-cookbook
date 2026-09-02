export interface PageSnapshot {
  url: string
  title: string
  text: string
  screenshotPath: string
  sessionId: string
}

export interface BrowserFoundationOptions {
  apiKey: string
  url: string
  runDir: string
}

export type Severity = "critical" | "high" | "medium" | "low" | "informational"
export type BugCategory = "functional" | "validation" | "navigation" | "authentication" | "authorization" | "ui" | "performance" | "error handling" | "state management" | "data integrity"

export interface BugReport {
  id: string
  title: string
  severity: Severity
  category: BugCategory
  confidence: number
  status: "verified" | "unconfirmed"
  url: string
  description: string
  expectedBehavior: string
  actualBehavior: string
  reproductionSteps: string[]
  evidence: { screenshots: string[]; logs: string[]; errors: string[] }
  verification: { attempts: number; successfulAttempts: number }
  severityReason: string
  timestamp: string
  runId: string
}

export interface RunState {
  runId: string
  targetUrl: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  currentTest?: string
  currentStep: number
  events: Array<Record<string, unknown>>
  issues: BugReport[]
  reports: BugReport[]
  startedAt: string
  finishedAt?: string
  error?: string
}