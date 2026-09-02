import { confidenceScore, verificationStatus } from "./confidence.js"

export interface VerificationAttempt {
  attempt: number
  reproduced: boolean
  evidence?: string[]
  error?: string
}

export interface VerificationResult {
  attempts: VerificationAttempt[]
  successfulAttempts: number
  confidence: number
  status: "verified" | "unconfirmed"
}

export async function verifyInFreshSessions(
  attempts: number,
  reproduce: (attempt: number) => Promise<{ reproduced: boolean; evidence?: string[] }>,
): Promise<VerificationResult> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new Error("attempts must be between 1 and 5")
  const results: VerificationAttempt[] = []
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await reproduce(attempt)
      results.push({ attempt, ...result })
    } catch (error) {
      results.push({ attempt, reproduced: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const successfulAttempts = results.filter((result) => result.reproduced).length
  return { attempts: results, successfulAttempts, confidence: confidenceScore(attempts, successfulAttempts), status: verificationStatus(attempts, successfulAttempts) }
}