import path from "node:path"
import dotenv from "dotenv"

export async function loadShipProofEnv(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false })
}