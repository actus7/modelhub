import type {
  HarnessCapability,
  HarnessPluginManifest,
  HarnessToolExecutionMode,
  HarnessToolRisk,
  HarnessToolSchema,
} from "../../lib/harness/contracts"

export type HarnessToolContext = {
  conversationId: string
  projectId: string | null
  runId: string
  operationId: string
  signal: AbortSignal
  userId: string
  invokeModel?: (prompt: string) => Promise<string>
}

export type HarnessToolDefinition = HarnessToolSchema & {
  execute: (args: Record<string, unknown>, context: HarnessToolContext) => Promise<unknown>
  executionMode?: HarnessToolExecutionMode
  risk: HarnessToolRisk | ((args: Record<string, unknown>) => HarnessToolRisk)
}

export type HarnessToolMiddleware = {
  id: string
  before?: (input: { args: Record<string, unknown>; context: HarnessToolContext; tool: HarnessToolDefinition }) => void | Promise<void>
  after?: (input: { args: Record<string, unknown>; context: HarnessToolContext; result: unknown; tool: HarnessToolDefinition }) => unknown | Promise<unknown>
  onError?: (input: { args: Record<string, unknown>; context: HarnessToolContext; error: unknown; tool: HarnessToolDefinition }) => void | Promise<void>
}

export type HarnessPlugin = HarnessPluginManifest & {
  register: (registry: HarnessRegistry) => void | (() => void)
}

export class HarnessRegistry {
  readonly #capabilities = new Map<string, HarnessCapability>()
  readonly #disposers: Array<() => void> = []
  readonly #plugins = new Map<string, HarnessPluginManifest>()
  readonly #tools = new Map<string, HarnessToolDefinition>()
  readonly #toolMiddleware = new Map<string, HarnessToolMiddleware>()

  addCapability(capability: HarnessCapability): () => void {
    this.#capabilities.set(capability.id, capability)
    return () => this.#capabilities.delete(capability.id)
  }

  addTool(tool: HarnessToolDefinition): () => void {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) {
      throw new Error(`Invalid harness tool name: ${tool.name}`)
    }
    if (this.#tools.has(tool.name)) {
      throw new Error(`Harness tool already registered: ${tool.name}`)
    }
    this.#tools.set(tool.name, tool)
    return () => this.#tools.delete(tool.name)
  }

  addToolMiddleware(middleware: HarnessToolMiddleware): () => void {
    if (this.#toolMiddleware.has(middleware.id)) throw new Error(`Harness tool middleware already registered: ${middleware.id}`)
    this.#toolMiddleware.set(middleware.id, middleware)
    return () => this.#toolMiddleware.delete(middleware.id)
  }

  dispose(): void {
    for (const dispose of this.#disposers.reverse()) dispose()
    this.#disposers.length = 0
    this.#plugins.clear()
    this.#tools.clear()
    this.#toolMiddleware.clear()
    this.#capabilities.clear()
  }

  getTool(name: string): HarnessToolDefinition | undefined {
    return this.#tools.get(name)
  }

  async executeTool(name: string, args: Record<string, unknown>, context: HarnessToolContext): Promise<unknown> {
    const tool = this.#tools.get(name)
    if (!tool) throw new Error(`Unknown or unavailable tool: ${name}`)
    const middleware = [...this.#toolMiddleware.values()]
    try {
      for (const hook of middleware) await hook.before?.({ args, context, tool })
      let result = await tool.execute(args, context)
      for (const hook of [...middleware].reverse()) {
        if (hook.after) result = await hook.after({ args, context, result, tool })
      }
      return result
    } catch (error) {
      for (const hook of [...middleware].reverse()) await hook.onError?.({ args, context, error, tool })
      throw error
    }
  }

  listCapabilities(): HarnessCapability[] {
    return [...this.#capabilities.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  listPlugins(): HarnessPluginManifest[] {
    return [...this.#plugins.values()].sort((a, b) => a.id.localeCompare(b.id))
  }

  listTools(): HarnessToolDefinition[] {
    return [...this.#tools.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  mount(plugin: HarnessPlugin): () => void {
    if (this.#plugins.has(plugin.id)) {
      throw new Error(`Harness plugin already mounted: ${plugin.id}`)
    }
    this.#plugins.set(plugin.id, {
      capabilities: plugin.capabilities,
      description: plugin.description,
      id: plugin.id,
      version: plugin.version,
    })
    const pluginDisposer = plugin.register(this)
    const dispose = () => {
      pluginDisposer?.()
      this.#plugins.delete(plugin.id)
    }
    this.#disposers.push(dispose)
    return dispose
  }

  openAiSchemas(): Array<{
    type: "function"
    function: { description: string; name: string; parameters: HarnessToolSchema["inputSchema"] }
  }> {
    return this.listTools().map((tool) => ({
      type: "function",
      function: {
        description: tool.description,
        name: tool.name,
        parameters: tool.inputSchema,
      },
    }))
  }
}
