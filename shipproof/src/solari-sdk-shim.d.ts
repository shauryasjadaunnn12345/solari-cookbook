declare module "@solarisdk/sdk" {
  export class SolariClient {
    constructor(options: { apiKey: string })
    sandboxes: { create(options: { template: string; timeoutMs: number }): Promise<Sandbox> }
  }
  interface Sandbox {
    connect(): Promise<void>
    kill(): Promise<void>
    files: { write(path: string, content: string): Promise<void> }
    previewUrl(port: number): Promise<{ url: string }>
    commands: { run(command: string, options: { args: string[] }): Promise<{ stdout: string; stderr: string; exitCode: number }> }
  }
}