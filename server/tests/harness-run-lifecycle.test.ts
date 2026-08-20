import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateApprovals: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock("../lib/db", () => {
  const tx = {
    agentRun: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
    sessionEvent: { createMany: mocks.createMany },
    toolApproval: { updateMany: mocks.updateApprovals },
  }
  return {
    prisma: {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
      agentRun: { findFirst: mocks.findFirst },
    },
  }
})

import {
  buildRunReplaySnapshot,
  findActiveRootRun,
  reconcileStaleRootRuns,
} from "../harness/run-lifecycle"

describe("harness run lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createMany.mockResolvedValue({ count: 2 })
    mocks.findMany.mockResolvedValue([{ id: "run-orphan" }])
    mocks.updateApprovals.mockResolvedValue({ count: 0 })
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })

  it("atomically retires an orphaned root run and records terminal events", async () => {
    const reconciled = await reconcileStaleRootRuns({
      conversationId: "conversation-1",
      now: new Date("2026-08-20T12:00:00.000Z"),
      userId: "user-1",
    })

    expect(reconciled).toEqual(["run-orphan"])
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseExpiresAt: null,
          leaseToken: null,
          status: "failed",
        }),
        where: expect.objectContaining({ id: "run-orphan" }),
      }),
    )
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ runId: "run-orphan", type: "run/error" }),
        expect.objectContaining({ runId: "run-orphan", type: "run/status" }),
      ]),
    })
  })

  it("does not retire a run whose lease was renewed during reconciliation", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 })

    await expect(
      reconcileStaleRootRuns({
        conversationId: "conversation-1",
        now: new Date("2026-08-20T12:00:00.000Z"),
        userId: "user-1",
      }),
    ).resolves.toEqual([])
    expect(mocks.createMany).not.toHaveBeenCalled()
  })

  it("selects only active root runs owned by the conversation user", async () => {
    mocks.findFirst.mockResolvedValue({ id: "run-active", status: "running" })

    await expect(findActiveRootRun("conversation-1", "user-1")).resolves.toEqual({
      id: "run-active",
      status: "running",
    })
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: "conversation-1",
          parentRunId: null,
          userId: "user-1",
        }),
      }),
    )
  })

  it("reconstructs a terminal replay from durable chunks", () => {
    expect(
      buildRunReplaySnapshot([
        { payload: { deltas: ["parte ", "um"] }, type: "assistant/chunk" },
        { payload: { deltas: [" e dois"] }, type: "assistant/chunk" },
        {
          payload: {
            content: "fallback",
            messageId: "message-final",
            modelLabel: "Auto · Reasoning",
          },
          type: "assistant/message",
        },
      ]),
    ).toEqual({
      content: "parte um e dois",
      messageId: "message-final",
      modelLabel: "Auto · Reasoning",
    })
  })
})
