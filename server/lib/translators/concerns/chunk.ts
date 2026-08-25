// Build OpenAI chat.completion.chunk. Caller supplies id/created/model so each
// translator keeps its exact id-generation + created semantics (no Date.now here).
export interface ChunkMeta {
  id: string;
  created: number;
  model: string;
}

export interface OpenAIChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Record<string, unknown>;
    finish_reason: string | null;
  }>;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export function buildChunk(
  meta: ChunkMeta,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): OpenAIChunk {
  return {
    id: meta.id,
    object: 'chat.completion.chunk',
    created: meta.created,
    model: meta.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}
