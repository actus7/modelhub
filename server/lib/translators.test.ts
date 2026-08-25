import { describe, it, expect } from 'vitest';
import {
  FORMATS,
  register,
  getTranslator,
  translateRequest,
  translateResponse,
  needsTranslation,
  initState,
  detectFormatByEndpoint,
} from './translators/index.js';

describe('translator engine', () => {
  describe('FORMATS constants', () => {
    it('should expose all expected format constants', () => {
      expect(FORMATS.OPENAI).toBe('openai');
      expect(FORMATS.CLAUDE).toBe('claude');
      expect(FORMATS.GEMINI).toBe('gemini');
      expect(FORMATS.GEMINI_CLI).toBe('gemini-cli');
      expect(FORMATS.VERTEX).toBe('vertex');
      expect(FORMATS.KIRO).toBe('kiro');
      expect(FORMATS.CURSOR).toBe('cursor');
      expect(FORMATS.OLLAMA).toBe('ollama');
      expect(FORMATS.COMMANDCODE).toBe('commandcode');
      expect(FORMATS.ANTIGRAVITY).toBe('antigravity');
      expect(FORMATS.OPENAI_RESPONSES).toBe('openai-responses');
      expect(FORMATS.CODEX).toBe('codex');
    });
  });

  describe('format detection', () => {
    it('should detect openai-responses from /v1/responses endpoint', () => {
      expect(detectFormatByEndpoint('/v1/responses', {})).toBe(FORMATS.OPENAI_RESPONSES);
    });

    it('should detect claude from /v1/messages endpoint', () => {
      expect(detectFormatByEndpoint('/v1/messages', {})).toBe(FORMATS.CLAUDE);
    });

    it('should return null for unknown endpoints', () => {
      expect(detectFormatByEndpoint('/v1/chat/completions', {})).toBeNull();
    });
  });

  describe('translator registration', () => {
    it('should have all request translators registered', () => {
      const requestPairs = [
        ['claude', 'openai'],
        ['openai', 'claude'],
        ['gemini', 'openai'],
        ['gemini-cli', 'openai'],
        ['openai', 'gemini'],
        ['openai', 'vertex'],
        ['antigravity', 'openai'],
        ['openai-responses', 'openai'],
        ['openai', 'openai-responses'],
        ['openai', 'kiro'],
        ['openai', 'cursor'],
        ['openai', 'ollama'],
        ['openai', 'commandcode'],
        ['claude', 'kiro'],
      ];

      for (const [from, to] of requestPairs) {
        const translator = getTranslator(from, to, 'request');
        expect(translator, `request translator ${from} -> ${to} should be registered`).toBeTruthy();
        expect(typeof translator).toBe('function');
      }
    });

    it('should have all response translators registered', () => {
      const responsePairs = [
        ['claude', 'openai'],
        ['openai', 'claude'],
        ['gemini', 'openai'],
        ['gemini-cli', 'openai'],
        ['antigravity', 'openai'],
        ['vertex', 'openai'],
        ['kiro', 'openai'],
        ['kiro', 'claude'],
        ['cursor', 'openai'],
        ['ollama', 'openai'],
        ['commandcode', 'openai'],
        ['openai', 'openai-responses'],
        ['openai-responses', 'openai'],
        ['openai', 'antigravity'],
      ];

      for (const [from, to] of responsePairs) {
        const translator = getTranslator(from, to, 'response');
        expect(translator, `response translator ${from} -> ${to} should be registered`).toBeTruthy();
        expect(typeof translator).toBe('function');
      }
    });
  });

  describe('needsTranslation', () => {
    it('should return false for same format', () => {
      expect(needsTranslation('openai', 'openai')).toBe(false);
    });

    it('should return true for different formats', () => {
      expect(needsTranslation('openai', 'claude')).toBe(true);
    });
  });

  describe('initState', () => {
    it('should create base state for openai format', () => {
      const state = initState('openai');
      expect(state.messageId).toBeNull();
      expect(state.model).toBeNull();
      expect(state.textBlockStarted).toBe(false);
      expect(state.toolCalls).toBeInstanceOf(Map);
      expect(state.finishReason).toBeNull();
    });

    it('should create extended state for openai-responses format', () => {
      const state = initState('openai-responses');
      expect(state.seq).toBe(0);
      expect(state.started).toBe(false);
      expect(state.msgTextBuf).toEqual({});
      expect(state.customToolNames).toBeInstanceOf(Set);
    });
  });

  describe('OpenAI ↔ Claude round-trip', () => {
    it('should translate OpenAI request to Claude format', () => {
      const openaiBody = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        max_tokens: 1024,
        stream: true,
      };

      const result = translateRequest('openai', 'claude', 'claude-sonnet-4-20250514', openaiBody, true);

      expect(result).toBeTruthy();
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.max_tokens).toBe(1024);
      expect(result.stream).toBe(true);
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      // System should be extracted to top-level system field
      expect(result.system).toBeDefined();
      expect(Array.isArray(result.system)).toBe(true);
    });

    it('should translate Claude request to OpenAI format', () => {
      const claudeBody = {
        model: 'claude-sonnet-4-20250514',
        messages: [
          { role: 'user', content: 'Hello!' },
        ],
        max_tokens: 1024,
        system: [{ type: 'text', text: 'You are helpful.' }],
      };

      const result = translateRequest('claude', 'openai', 'claude-sonnet-4-20250514', claudeBody, true);

      expect(result).toBeTruthy();
      expect(result.model).toBe('claude-sonnet-4-20250514');
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      // System message should be in messages array
      const systemMsg = (result.messages as Array<Record<string, unknown>>).find(m => m.role === 'system');
      expect(systemMsg).toBeTruthy();
    });

    it('should translate Claude response chunk to OpenAI format', () => {
      const state = initState('claude');
      const claudeChunk = {
        type: 'message_start',
        message: { id: 'msg_123', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 10, output_tokens: 0 } },
      };

      const result = translateResponse('claude', 'openai', claudeChunk, state);

      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      const firstChunk = result[0] as Record<string, unknown>;
      expect(firstChunk.object).toBe('chat.completion.chunk');
      expect(firstChunk.choices).toBeDefined();
    });

    it('should translate OpenAI response chunk to Claude format', () => {
      const state = initState('openai');
      const openaiChunk = {
        id: 'chatcmpl-123',
        model: 'gpt-4',
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      };

      const result = translateResponse('openai', 'claude', openaiChunk, state);

      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
      // First event should be message_start
      const firstEvent = result[0] as Record<string, unknown>;
      expect(firstEvent.type).toBe('message_start');
    });
  });

  describe('OpenAI ↔ Gemini round-trip', () => {
    it('should translate OpenAI request to Gemini format', () => {
      const openaiBody = {
        model: 'gemini-2.0-flash',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
        max_tokens: 1024,
        temperature: 0.7,
      };

      const result = translateRequest('openai', 'gemini', 'gemini-2.0-flash', openaiBody, true);

      expect(result).toBeTruthy();
      expect(result.model).toBe('gemini-2.0-flash');
      expect(result.contents).toBeDefined();
      expect(Array.isArray(result.contents)).toBe(true);
      expect(result.generationConfig).toBeDefined();
      expect((result.generationConfig as Record<string, unknown>).temperature).toBe(0.7);
      expect(result.safetySettings).toBeDefined();
    });

    it('should translate Gemini request to OpenAI format', () => {
      const geminiBody = {
        model: 'gemini-2.0-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Hello!' }] },
        ],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      };

      const result = translateRequest('gemini', 'openai', 'gemini-2.0-flash', geminiBody, true);

      expect(result).toBeTruthy();
      expect(result.model).toBe('gemini-2.0-flash');
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      expect((result.messages as unknown[]).length).toBeGreaterThan(0);
    });

    it('should translate Gemini response chunk to OpenAI format', () => {
      const state = initState('gemini');
      const geminiChunk = {
        response: {
          responseId: 'resp_123',
          modelVersion: 'gemini-2.0-flash',
          candidates: [{
            content: { role: 'model', parts: [{ text: 'Hello!' }] },
            finishReason: null,
          }],
        },
      };

      const result = translateResponse('gemini', 'openai', geminiChunk, state);

      expect(result).toBeTruthy();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      const firstChunk = result[0] as Record<string, unknown>;
      expect(firstChunk.object).toBe('chat.completion.chunk');
    });
  });

  describe('OpenAI ↔ Ollama translation', () => {
    it('should translate OpenAI request to Ollama format', () => {
      const openaiBody = {
        model: 'llama3',
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 512,
        temperature: 0.5,
      };

      const result = translateRequest('openai', 'ollama', 'llama3', openaiBody, true);

      expect(result).toBeTruthy();
      expect(result.model).toBe('llama3');
      expect(result.messages).toBeDefined();
      expect(result.stream).toBe(true);
      expect(result.options).toBeDefined();
      expect((result.options as Record<string, unknown>).temperature).toBe(0.5);
      expect((result.options as Record<string, unknown>).num_predict).toBe(512);
    });
  });

  describe('OpenAI ↔ Cursor translation', () => {
    it('should translate OpenAI request to Cursor format', () => {
      const openaiBody = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
      };

      const result = translateRequest('openai', 'cursor', 'gpt-4', openaiBody, true);

      expect(result).toBeTruthy();
      expect(result.messages).toBeDefined();
      // System message should be converted to user with prefix
      const messages = result.messages as Array<Record<string, unknown>>;
      expect(messages[0].role).toBe('user');
      expect(messages[0].content).toContain('[System Instructions]');
    });
  });

  describe('OpenAI ↔ CommandCode translation', () => {
    it('should translate OpenAI request to CommandCode format', () => {
      const openaiBody = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello!' }],
        max_tokens: 1024,
      };

      const result = translateRequest('openai', 'commandcode', 'gpt-4', openaiBody, true);

      expect(result).toBeTruthy();
      expect(result.threadId).toBeDefined();
      expect(result.params).toBeDefined();
      const params = result.params as Record<string, unknown>;
      expect(params.model).toBe('gpt-4');
      expect(params.messages).toBeDefined();
    });
  });

  describe('OpenAI Responses API translation', () => {
    it('should translate Responses API request to Chat Completions format', () => {
      const responsesBody = {
        model: 'gpt-4',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello!' }] },
        ],
        instructions: 'Be helpful.',
      };

      const result = translateRequest('openai-responses', 'openai', 'gpt-4', responsesBody, true);

      expect(result).toBeTruthy();
      expect(result.messages).toBeDefined();
      expect(Array.isArray(result.messages)).toBe(true);
      // Should have system message from instructions
      const systemMsg = (result.messages as Array<Record<string, unknown>>).find(m => m.role === 'system');
      expect(systemMsg).toBeTruthy();
      expect(systemMsg!.content).toBe('Be helpful.');
    });

    it('should translate Chat Completions request to Responses API format', () => {
      const chatBody = {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Hello!' },
        ],
      };

      const result = translateRequest('openai', 'openai-responses', 'gpt-4', chatBody, true);

      expect(result).toBeTruthy();
      expect(result.input).toBeDefined();
      expect(Array.isArray(result.input)).toBe(true);
      expect(result.instructions).toBe('Be helpful.');
    });
  });

  describe('same-format passthrough', () => {
    it('should return body unchanged when source and target are the same', () => {
      const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }] };
      const result = translateRequest('openai', 'openai', 'gpt-4', body, true);
      expect(result).toBe(body);
    });

    it('should return chunk as-is when source and target response are the same', () => {
      const state = initState('openai');
      const chunk = { id: 'test', object: 'chat.completion.chunk', choices: [] };
      const result = translateResponse('openai', 'openai', chunk, state);
      expect(result).toEqual([chunk]);
    });
  });
});
