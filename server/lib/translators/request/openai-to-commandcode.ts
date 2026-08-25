// OpenAI to CommandCode request translator
import { registerTranslator as register } from '../registry.js';
import { FORMATS } from '../formats.js';
import { randomUUID } from 'crypto';
import { ROLE, OPENAI_BLOCK } from '../schema/index.js';
import { DEFAULT_MAX_TOKENS } from '../schema/defaults.js';

function flattenText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).map(p => {
      if (typeof p === 'string') return p;
      if (p && typeof p === 'object' && typeof p.text === 'string') return p.text;
      return '';
    }).join('\n');
  }
  return String(content);
}

function toContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (content == null) return [{ type: OPENAI_BLOCK.TEXT, text: '' }];
  if (typeof content === 'string') return [{ type: OPENAI_BLOCK.TEXT, text: content }];
  if (Array.isArray(content)) {
    const blocks: Record<string, unknown>[] = [];
    for (const part of content as Array<Record<string, unknown>>) {
      if (typeof part === 'string') blocks.push({ type: OPENAI_BLOCK.TEXT, text: part });
      else if (part && typeof part === 'object') {
        if (part.type === OPENAI_BLOCK.TEXT && typeof part.text === 'string') blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
        else if (part.type === OPENAI_BLOCK.IMAGE_URL || part.type === OPENAI_BLOCK.IMAGE) blocks.push({ type: OPENAI_BLOCK.TEXT, text: '[image omitted]' });
        else if (typeof part.text === 'string') blocks.push({ type: OPENAI_BLOCK.TEXT, text: part.text });
      }
    }
    return blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: '' }];
  }
  return [{ type: OPENAI_BLOCK.TEXT, text: String(content) }];
}

function safeParseJson(s: unknown): Record<string, unknown> {
  if (s == null) return {};
  if (typeof s !== 'string') return s as Record<string, unknown>;
  try { return JSON.parse(s); } catch { return {}; }
}

function convertMessages(messages: Array<Record<string, unknown>> = []): { messages: Array<Record<string, unknown>>; system: string } {
  const out: Record<string, unknown>[] = [];
  const systemTexts: string[] = [];

  for (const m of messages) {
    if (!m) continue;
    const role = m.role as string;
    if (role === ROLE.SYSTEM) { const t = flattenText(m.content); if (t) systemTexts.push(t); continue; }
    if (role === ROLE.TOOL) {
      const value = typeof m.content === 'string' ? m.content : flattenText(m.content);
      out.push({ role: ROLE.TOOL, content: [{ type: 'tool-result', toolCallId: m.tool_call_id || '', toolName: m.name || '', output: { type: 'text', value } }] });
      continue;
    }
    if (role === ROLE.ASSISTANT) {
      const blocks: Record<string, unknown>[] = [];
      const text = flattenText(m.content);
      if (text) blocks.push({ type: OPENAI_BLOCK.TEXT, text });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls as Array<Record<string, unknown>>) {
          const fn = (tc.function as Record<string, unknown>) || {};
          blocks.push({ type: 'tool-call', toolCallId: tc.id || '', toolName: fn.name || '', input: safeParseJson(fn.arguments) });
        }
      }
      out.push({ role: ROLE.ASSISTANT, content: blocks.length ? blocks : [{ type: OPENAI_BLOCK.TEXT, text: '' }] });
      continue;
    }
    out.push({ role: ROLE.USER, content: toContentBlocks(m.content) });
  }
  return { messages: out, system: systemTexts.join('\n\n') };
}

function convertTools(tools: unknown[]): Record<string, unknown>[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const result: Record<string, unknown>[] = [];
  for (const t of tools as Array<Record<string, unknown>>) {
    if (!t) continue;
    if (t.type === OPENAI_BLOCK.FUNCTION && t.function) {
      const fn = t.function as Record<string, unknown>;
      result.push({ name: fn.name, description: fn.description, input_schema: fn.parameters || { type: 'object' } });
    } else if (t.name && (t.input_schema || t.parameters)) {
      result.push({ name: t.name, description: t.description, input_schema: t.input_schema || t.parameters });
    }
  }
  return result.length ? result : undefined;
}

export function openaiToCommandCodeRequest(model: string, body: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const { messages, system } = convertMessages(body.messages as Array<Record<string, unknown>>);
  const params: Record<string, unknown> = {
    model,
    messages,
    stream: stream !== false,
    max_tokens: body.max_tokens ?? body.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    temperature: body.temperature ?? 0.3,
  };
  if (system) params.system = system;
  const tools = convertTools(body.tools as unknown[]);
  if (tools) params.tools = tools;
  if (body.top_p != null) params.top_p = body.top_p;

  return {
    threadId: randomUUID(),
    memory: '',
    config: { workingDir: process.cwd(), date: new Date().toISOString().slice(0, 10), environment: process.platform, structure: [], isGitRepo: false, currentBranch: '', mainBranch: '', gitStatus: '', recentCommits: [] },
    params,
  };
}

register(FORMATS.OPENAI, FORMATS.COMMANDCODE, openaiToCommandCodeRequest, null);
