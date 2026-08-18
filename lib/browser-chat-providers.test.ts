import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
  apiJson: vi.fn(),
  apiJsonRequest: vi.fn(),
  testProviderCredentials: vi.fn(),
}));

import { apiJson } from "@/lib/api";
import {
  buildBrowserSystemPrompt,
  formatProjectContext,
} from "./browser-chat-providers";

const mockedApiJson = vi.mocked(apiJson);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildBrowserSystemPrompt", () => {
  it("keeps default prompt + settings/memories when no projectId is provided", async () => {
    mockedApiJson
      .mockResolvedValueOnce({
        settings: {
          customInstructionsAbout: "Chame-me de Ana",
          customInstructionsStyle: "Seja concisa",
        },
      })
      .mockResolvedValueOnce({
        memories: [{ content: "Prefere respostas em pt-BR" }],
      });

    const prompt = await buildBrowserSystemPrompt();

    expect(mockedApiJson).toHaveBeenCalledTimes(2);
    expect(mockedApiJson).toHaveBeenCalledWith("/user/settings");
    expect(mockedApiJson).toHaveBeenCalledWith("/user/memories");
    expect(mockedApiJson).not.toHaveBeenCalledWith("/projects/proj-1/context");
    expect(prompt).toContain("About the user: Chame-me de Ana");
    expect(prompt).toContain("Response style: Seja concisa");
    expect(prompt).toContain("User memories:\n- Prefere respostas em pt-BR");
  });

  it("fetches project context when projectId is provided and appends the same sections", async () => {
    mockedApiJson
      .mockResolvedValueOnce({
        settings: { customInstructionsAbout: null, customInstructionsStyle: null },
      })
      .mockResolvedValueOnce({ memories: [] })
      .mockResolvedValueOnce({
        instructions: "Sempre responda em pt-BR",
        knowledge: [
          { fileName: "a.pdf", text: "Conteúdo do arquivo A" },
          { fileName: "b.md", text: "Conteúdo do arquivo B" },
        ],
      });

    const prompt = await buildBrowserSystemPrompt("proj-1");

    expect(mockedApiJson).toHaveBeenCalledTimes(3);
    expect(mockedApiJson).toHaveBeenCalledWith("/projects/proj-1/context");
    expect(prompt).toContain("Project instructions:\nSempre responda em pt-BR");
    expect(prompt).toContain("Project knowledge:\n[a.pdf]\nConteúdo do arquivo A");
    expect(prompt).toContain("[b.md]\nConteúdo do arquivo B");
  });

  it("proceeds without project context when the project context fetch fails", async () => {
    mockedApiJson
      .mockResolvedValueOnce({
        settings: {
          customInstructionsAbout: "Chame-me de Ana",
          customInstructionsStyle: null,
        },
      })
      .mockResolvedValueOnce({ memories: [] })
      .mockRejectedValueOnce(new Error("HTTP 404"));

    const prompt = await buildBrowserSystemPrompt("proj-inexistente");

    expect(mockedApiJson).toHaveBeenCalledWith("/projects/proj-inexistente/context");
    expect(prompt).toContain("About the user: Chame-me de Ana");
    expect(prompt).not.toContain("Project instructions:");
    expect(prompt).not.toContain("Project knowledge:");
  });
});

describe("formatProjectContext", () => {
  it("returns null when there is nothing to inject", () => {
    expect(formatProjectContext({ instructions: null, knowledge: [] })).toBeNull();
    expect(formatProjectContext({ instructions: "", knowledge: [{ fileName: "x", text: "" }] })).toBeNull();
  });

  it("enforces instructions 20k cap and per-file 20k / total 60k knowledge caps", () => {
    const section = formatProjectContext({
      instructions: "i".repeat(25_000),
      knowledge: [
        { fileName: "a.pdf", text: "x".repeat(25_000) },
        { fileName: "b.pdf", text: "y".repeat(25_000) },
        { fileName: "c.pdf", text: "z".repeat(25_000) },
        { fileName: "d.pdf", text: "w".repeat(25_000) },
      ],
    });

    expect(section).toContain(`Project instructions:\n${"i".repeat(20_000)}`);
    expect(section).not.toContain("i".repeat(20_001));
    expect(section).toContain(`[a.pdf]\n${"x".repeat(20_000)}`);
    expect(section).toContain(`[b.pdf]\n${"y".repeat(20_000)}`);
    expect(section).toContain(`[c.pdf]\n${"z".repeat(20_000)}`);
    expect(section).not.toContain("[d.pdf]");
    expect(section).not.toContain("w".repeat(20_000));
  });
});
