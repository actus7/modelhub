import type { ProviderModel } from "@/lib/contracts";

const PUTER_SCRIPT_URL = "https://js.puter.com/v2/";

export type PuterChatMessage = {
  content: string;
  role: "assistant" | "system" | "tool" | "user";
  tool_call_id?: string;
};

type PuterChatChunk = {
  reasoning?: string;
  text?: string;
  type?: string;
};

type PuterChatResponse = {
  message?: {
    content?: string;
    tool_calls?: unknown[];
  };
  text?: string;
};

type PuterGlobal = {
  ai: {
    chat: (
      messages: PuterChatMessage[],
      options: { model: string; stream: true },
    ) => Promise<AsyncIterable<PuterChatChunk> | PuterChatResponse | string>;
  };
  auth: {
    getUser: () => Promise<unknown>;
    isSignedIn: () => boolean | Promise<boolean>;
    signIn: (options?: { attempt_temp_user_creation?: boolean }) => Promise<unknown>;
  };
};

declare global {
  interface Window {
    puter?: PuterGlobal;
  }
}

let puterLoadPromise: Promise<PuterGlobal> | null = null;

function getWindow(): Window {
  if (typeof window === "undefined") {
    throw new Error("Puter.js so esta disponivel no navegador.");
  }
  return window;
}

function resolveLoadedPuter(): PuterGlobal {
  const puter = getWindow().puter;
  if (!puter?.ai?.chat || !puter.auth?.signIn) {
    throw new Error("Puter.js foi carregado, mas a API esperada nao esta disponivel.");
  }
  return puter;
}

function loadPuter(): Promise<PuterGlobal> {
  const win = getWindow();
  if (win.puter?.ai?.chat) {
    return Promise.resolve(win.puter);
  }
  if (puterLoadPromise) {
    return puterLoadPromise;
  }

  const loadPromise = new Promise<PuterGlobal>((resolve, reject) => {
    const existingScript = win.document.querySelector<HTMLScriptElement>(
      'script[data-modelhub-puter="true"]',
    );

    const handleLoad = () => {
      try {
        resolve(resolveLoadedPuter());
      } catch (error) {
        reject(error);
      }
    };

    if (existingScript) {
      if (existingScript.dataset.modelhubPuterLoaded === "true") {
        handleLoad();
        return;
      }
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener(
        "error",
        () => reject(new Error("Nao foi possivel carregar Puter.js.")),
        { once: true },
      );
      return;
    }

    const script = win.document.createElement("script");
    script.async = true;
    script.dataset.modelhubPuter = "true";
    script.src = PUTER_SCRIPT_URL;
    script.addEventListener("load", () => {
      script.dataset.modelhubPuterLoaded = "true";
      handleLoad();
    }, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Nao foi possivel carregar Puter.js.")),
      { once: true },
    );
    win.document.head.appendChild(script);
  }).catch((error) => {
    puterLoadPromise = null;
    throw error;
  });
  puterLoadPromise = loadPromise;

  return loadPromise;
}

export async function isPuterSignedIn(): Promise<boolean> {
  const puter = await loadPuter();
  return Boolean(await puter.auth.isSignedIn());
}

export async function signInToPuter(): Promise<void> {
  const puter = await loadPuter();
  await puter.auth.signIn({ attempt_temp_user_creation: true });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<PuterChatChunk> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function extractResponseText(response: PuterChatResponse | string): string {
  if (typeof response === "string") {
    return response;
  }
  if (typeof response.message?.content === "string") {
    return response.message.content;
  }
  if (typeof response.text === "string") {
    return response.text;
  }
  return "";
}

function extractChunkText(chunk: PuterChatChunk | string): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (typeof chunk.text === "string") {
    return chunk.text;
  }
  return "";
}

function abortError(): DOMException {
  return new DOMException("Operacao cancelada pelo usuario.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(abortError());
    signal.addEventListener("abort", handleAbort, { once: true });

    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
}

export async function streamPuterChat(input: {
  messages: PuterChatMessage[];
  modelId: ProviderModel["id"];
  onTextDelta: (delta: string) => void;
  signal: AbortSignal;
}): Promise<string> {
  throwIfAborted(input.signal);

  const puter = await loadPuter();
  if (!(await puter.auth.isSignedIn())) {
    await puter.auth.signIn({ attempt_temp_user_creation: true });
  }

  throwIfAborted(input.signal);

  const response = await withAbort(
    puter.ai.chat(input.messages, { model: input.modelId, stream: true }),
    input.signal,
  );

  if (!isAsyncIterable(response)) {
    const text = extractResponseText(response);
    if (text) {
      input.onTextDelta(text);
    }
    return text;
  }

  const iterator = response[Symbol.asyncIterator]();
  let fullText = "";
  while (true) {
    const result = await withAbort(iterator.next(), input.signal);
    if (result.done) {
      break;
    }

    const delta = extractChunkText(result.value);
    if (!delta) {
      continue;
    }
    fullText += delta;
    input.onTextDelta(delta);
  }

  return fullText;
}
