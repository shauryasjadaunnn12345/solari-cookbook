import type { BugReport } from "../types.js"

export function serializeReport(report: BugReport): string {
  return JSON.stringify(report, null, 2)
}

export function reportMarkdown(report: BugReport): string {
  const steps = report.reproductionSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")
  const screenshots = report.evidence.screenshots.map((file) => `- ${file}`).join("\n") || "- None"
  return `# ${report.id}: ${report.title}

**Status:** ${report.status.toUpperCase()}  
**Severity:** ${report.severity.toUpperCase()}  
**Category:** ${report.category}  
**Confidence:** ${report.confidence}%  
**URL:** ${report.url}

## Description
${report.description}

## Expected behavior
${report.expectedBehavior}

## Actual behavior
${report.actualBehavior}

## Reproduction steps
${steps}

## Verification
${report.verification.successfulAttempts}/${report.verification.attempts} reproductions succeeded.

## Evidence
${screenshots}

**Severity rationale:** ${report.severityReason}
`
}