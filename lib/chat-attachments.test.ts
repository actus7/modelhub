import { describe, expect, it } from "vitest";

import {
  estimateSerializedPayloadBytes,
  getTotalAttachmentBytes,
  isSerializedPayloadTooLarge,
  MAX_ATTACHMENT_FILE_BYTES,
  MAX_DOCUMENT_ATTACHMENT_FILE_BYTES,
  MAX_SERIALIZED_CHAT_REQUEST_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  validateFileSelection,
} from "./chat-attachments";

/** Builds a File with a forced byte size, avoiding the need to allocate real MB of data. */
function makeFile(name: string, type: string, size: number): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const ALLOW_ALL = { allowImages: true, allowDocuments: true };
const PNG = "image/png";
const PDF = "application/pdf";

describe("chat attachment helpers", () => {
  it("sums attachment sizes", () => {
    expect(getTotalAttachmentBytes([{ size: 512 }, { size: 1024 }, { size: 2048 }])).toBe(3584);
  });

  it("estimates serialized payload size", () => {
    const payload = {
      id: "request-1",
      messages: [{ role: "user", parts: [{ type: "text", text: "hello world" }] }],
      modelId: "openrouter/gpt-4o-mini",
      trigger: "submit-message",
    };

    expect(estimateSerializedPayloadBytes(payload)).toBeGreaterThan(0);
  });

  it("flags payloads above the configured budget", () => {
    const payload = {
      messages: [{ role: "user", content: "x".repeat(MAX_SERIALIZED_CHAT_REQUEST_BYTES) }],
    };

    expect(isSerializedPayloadTooLarge(payload)).toBe(true);
  });
});

describe("validateFileSelection", () => {
  it("accepts valid image and document files with the right kind", () => {
    const { accepted, errors } = validateFileSelection(
      [makeFile("a.png", PNG, 1000), makeFile("b.pdf", PDF, 2000)],
      [],
      ALLOW_ALL,
    );
    expect(errors).toEqual([]);
    expect(accepted).toEqual([
      { file: expect.any(File), kind: "image" },
      { file: expect.any(File), kind: "document" },
    ]);
  });

  it("rejects unsupported file types", () => {
    const { accepted, errors } = validateFileSelection([makeFile("a.zip", "application/zip", 100)], [], ALLOW_ALL);
    expect(accepted).toEqual([]);
    expect(errors).toEqual(["Tipo nao suportado: a.zip."]);
  });

  it("rejects images when the image capability is off", () => {
    const { accepted, errors } = validateFileSelection([makeFile("a.png", PNG, 100)], [], {
      allowImages: false,
      allowDocuments: true,
    });
    expect(accepted).toEqual([]);
    expect(errors).toEqual(["O modelo selecionado nao aceita imagens."]);
  });

  it("rejects a file above the per-file limit", () => {
    const { accepted, errors } = validateFileSelection(
      [makeFile("big.png", PNG, MAX_ATTACHMENT_FILE_BYTES + 1)],
      [],
      ALLOW_ALL,
    );
    expect(accepted).toEqual([]);
    expect(errors[0]).toContain("Arquivo muito grande: big.png");
  });

  it("rejects a file that would exceed the cumulative image budget", () => {
    const half = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 2);
    const { accepted, errors } = validateFileSelection(
      [makeFile("new.png", PNG, half + 1)],
      [{ kind: "image", size: half }],
      ALLOW_ALL,
    );
    expect(accepted).toEqual([]);
    expect(errors[0]).toContain("Limite total de imagens excedido");
  });

  it("returns a mix of accepted files and errors in one pass", () => {
    const { accepted, errors } = validateFileSelection(
      [
        makeFile("ok.png", PNG, 1000),
        makeFile("bad.zip", "application/zip", 100),
        makeFile("big.pdf", PDF, MAX_DOCUMENT_ATTACHMENT_FILE_BYTES + 1),
        makeFile("doc.pdf", PDF, 2000),
      ],
      [],
      ALLOW_ALL,
    );
    expect(accepted.map((entry) => entry.kind)).toEqual(["image", "document"]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("Tipo nao suportado: bad.zip");
    expect(errors[1]).toContain("Arquivo muito grande: big.pdf");
  });
});
