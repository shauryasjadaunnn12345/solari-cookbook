import { createServer } from "node:http"
import { loadShipProofEnv } from "../src/config/env.js"

await loadShipProofEnv()

const port = Number(process.env.PORT ?? 4173)
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>ShipProof Demo App</title><style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px}section{border:1px solid #ddd;padding:20px;margin:16px 0}input,button{padding:10px;margin:4px}#message{min-height:24px}.danger{color:#b42318}</style></head>
<body><h1>Northstar Console</h1><p>Deterministic QA fixture for ShipProof.</p>
<section><h2>Sign in</h2><form id="login"><input id="email" type="email" placeholder="Email"><input id="password" type="password" placeholder="Password"><button>Sign in</button></form><p id="message"></p></section>
<section><h2>Workspace</h2><form id="workspace"><input id="workspaceName" placeholder="Workspace name"><button>Create workspace</button></form><p id="workspaceMessage"></p><button id="next">Open workspace</button></section>
<section><h2>Usage</h2><button id="increment">Refresh usage</button><strong id="count">0</strong><p id="usageMessage"></p></section>
<script>
const message = document.querySelector('#message');
document.querySelector('#login').addEventListener('submit', (event) => { event.preventDefault(); message.textContent = 'Welcome back!'; message.className = ''; });
document.querySelector('#workspace').addEventListener('submit', (event) => { event.preventDefault(); document.querySelector('#workspaceMessage').textContent = 'Workspace created'; });
document.querySelector('#next').addEventListener('click', () => { history.pushState({}, '', '/missing-workspace'); document.body.insertAdjacentHTML('beforeend', '<p class="danger" id="routeError">Workspace route failed to load.</p>'); });
let count = 0; document.querySelector('#increment').addEventListener('click', () => { count += 2; document.querySelector('#count').textContent = count; document.querySelector('#usageMessage').textContent = 'Usage refreshed'; });
</script></body></html>`

createServer(async (request, response) => {
  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    response.end(page)
    return
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
  response.end("Not found")
}).listen(port, "127.0.0.1", () => console.log(`ShipProof demo app: http://127.0.0.1:${port}`))