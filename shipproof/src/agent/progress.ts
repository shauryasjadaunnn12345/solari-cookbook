import type { QAAction } from "./actions.js"
import type { AgentObservation } from "./runner.js"

export type ProgressDecision = "continue" | "change_strategy" | "verify"

export function observationFingerprint(observation: AgentObservation): string {
  return JSON.stringify({ url: observation.url, title: observation.title, text: observation.text.slice(0, 8_000), elements: observation.interactiveElements.map(({ tag, role, text, selector }) => ({ tag, role, text, selector })) })
}

export function decideProgress(unchangedObservations: number, bugSuspected: boolean): ProgressDecision {
  if (bugSuspected) return "verify"
  return unchangedObservations >= 1 ? "change_strategy" : "continue"
}

export function actionTargetKey(action: QAAction): string {
  switch (action.name) {
    case "navigate": return `${action.name}:${action.url}`
    case "click": return `${action.name}:${action.selector}`
    case "type": return `${action.name}:${action.selector}`
    case "press_key": return `${action.name}:${action.key}`
    case "wait": return `${action.name}:${action.milliseconds}`
    default: return action.name
  }
}

export class ProgressTracker {
  private previousFingerprint = ""
  private lastActionKey = ""
  private unchangedObservations = 0
  private readonly actionCounts = new Map<string, number>()

  observe(observation: AgentObservation): number {
    const fingerprint = observationFingerprint(observation)
    this.unchangedObservations = fingerprint === this.previousFingerprint ? this.unchangedObservations + 1 : 0
    this.previousFingerprint = fingerprint
    return this.unchangedObservations
  }

  recordAction(action: QAAction): void {
    const key = actionTargetKey(action)
    this.lastActionKey = key
    this.actionCounts.set(key, (this.actionCounts.get(key) ?? 0) + 1)
  }

  shouldChangeStrategy(action: QAAction): boolean {
    return this.unchangedObservations >= 1 && actionTargetKey(action) === this.lastActionKey
  }

  blockedActionKeys(): string[] {
    return this.unchangedObservations >= 1 && this.lastActionKey ? [this.lastActionKey] : []
  }

  actionCount(actionKey: string): number {
    return this.actionCounts.get(actionKey) ?? 0
  }
}