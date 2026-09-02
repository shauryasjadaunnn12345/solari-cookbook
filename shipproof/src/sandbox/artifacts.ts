import { writeFile } from "node:fs/promises"
import path from "node:path"
import { SolariClient } from "@solarisdk/sdk"

export async function analyzeArtifacts(apiKey: string, runDir: string, eventJson: string): Promise<string> {
  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 5 * 60_000 })
  try {
    await sandbox.connect()
    await sandbox.files.write("/tmp/shipproof/events.json", eventJson)
    const result = await sandbox.commands.run("python3", { args: ["-c", "import json,sys; data=json.load(open('/tmp/shipproof/events.json')); print(json.dumps({'events':len(data),'errors':sum(1 for e in data if e.get('eventType') == 'error')}))"] })
    const summary = result.stdout.trim()
    await writeFile(path.join(runDir, "sandbox-analysis.json"), `${summary}\n`)
    return summary
  } finally {
    await sandbox.kill()
  }
}