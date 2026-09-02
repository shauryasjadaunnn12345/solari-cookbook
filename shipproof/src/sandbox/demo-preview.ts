import { SolariClient } from "@solarisdk/sdk"

const demoHtml = `<!doctype html><html><head><title>Northstar Console</title></head><body><h1>Northstar Console</h1><form id="login"><input id="email" type="email"><input id="password" type="password"><button>Sign in</button></form><p id="message"></p><form id="workspace"><input id="workspaceName"><button>Create workspace</button></form><p id="workspaceMessage"></p><button id="next">Open workspace</button><button id="increment">Refresh usage</button><strong id="count">0</strong><script>login.onsubmit=e=>{e.preventDefault();message.textContent='Welcome back!'};workspace.onsubmit=e=>{e.preventDefault();workspaceMessage.textContent='Workspace created'};next.onclick=()=>{history.pushState({},'', '/missing-workspace');document.body.insertAdjacentHTML('beforeend','<p id="routeError">Workspace route failed to load.</p>')};let count=0;increment.onclick=()=>{count+=2;document.querySelector('#count').textContent=count}</script></body></html>`

export async function createDemoPreview(apiKey: string, port = 4173) {
  const client = new SolariClient({ apiKey })
  const sandbox = await client.sandboxes.create({ template: "base", timeoutMs: 10 * 60_000 })
  await sandbox.connect()
  try {
    await sandbox.files.write("/tmp/shipproof-demo/index.html", demoHtml)
    await sandbox.commands.run("sh", { args: ["-c", `cd /tmp/shipproof-demo && nohup python3 -m http.server ${port} >/tmp/shipproof-demo.log 2>&1 &`] })
    const preview = await sandbox.previewUrl(port)
    return { url: preview.url, close: async () => { await sandbox.kill() } }
  } catch (error) {
    await sandbox.kill()
    throw error
  }
}