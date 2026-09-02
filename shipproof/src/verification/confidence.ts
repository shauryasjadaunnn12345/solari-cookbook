export function confidenceScore(attempts: number, successfulAttempts: number): number {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be positive")
  if (!Number.isInteger(successfulAttempts) || successfulAttempts < 0 || successfulAttempts > attempts) {
    throw new Error("successfulAttempts must be between 0 and attempts")
  }
  return Math.round((successfulAttempts / attempts) * 100)
}

export function verificationStatus(attempts: number, successfulAttempts: number): "verified" | "unconfirmed" {
  return successfulAttempts >= 2 && successfulAttempts / attempts >= 2 / 3 ? "verified" : "unconfirmed"
}