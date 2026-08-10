import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishEnvelopeBatch,
  useWhisperProtocolSync
} from "@/features/room-session/hooks/useWhisperProtocolSync";
import type {
  RoomProtocol,
  RoomProtocolMessageHandler,
  RoomProtocolPublishResult
} from "@/features/room-session/lib/room-protocol";
import { createEnvelope } from "@/lib/protocol";
import type { AnyProtocolEnvelope, ProtocolEventType, StateSnapshotPayload } from "@/lib/protocol";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Handler = (envelope: AnyProtocolEnvelope) => void;
type HarnessProps = {
  enabled?: boolean;
  protocol: RoomProtocol;
  identity?: string;
  applyEnvelope: (envelope: AnyProtocolEnvelope) => void;
  getSnapshot: () => StateSnapshotPayload;
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let publishFromHook: ReturnType<typeof useWhisperProtocolSync>["publishEnvelope"] | null = null;

function Harness({
  enabled = true,
  protocol,
  identity = "alice",
  applyEnvelope,
  getSnapshot
}: HarnessProps) {
  ({ publishEnvelope: publishFromHook } = useWhisperProtocolSync({
    enabled,
    protocol,
    identity,
    applyEnvelope,
    getSnapshot
  }));
  return null;
}

function createFakeProtocol(result: RoomProtocolPublishResult = { ok: true }) {
  const handlers = new Map<ProtocolEventType, Set<Handler>>();
  const publish = vi.fn(async () => result);
  const subscribe = vi.fn((type: ProtocolEventType, handler: Handler) => {
    const handlersForType = handlers.get(type) ?? new Set<Handler>();
    handlersForType.add(handler);
    handlers.set(type, handlersForType);
    return () => handlersForType.delete(handler);
  });
  const protocol: RoomProtocol = {
    publish: publish as RoomProtocol["publish"],
    subscribe: subscribe as unknown as RoomProtocol["subscribe"]
  };
  const emit = <T extends ProtocolEventType>(
    type: T,
    envelope: Parameters<RoomProtocolMessageHandler<T>>[0]
  ) => {
    handlers.get(type)?.forEach((handler) => handler(envelope));
  };
  return { emit, handlers, protocol, publish, subscribe };
}

function renderHarness(props: HarnessProps): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  publishFromHook = null;
});

describe("useWhisperProtocolSync", () => {
  it("stops a reassignment batch before the final mutation after a publish failure", async () => {
    const failure = { ok: false, reason: "publish-failed" } as const;
    const { protocol, publish } = createFakeProtocol();
    publish.mockResolvedValueOnce(failure).mockResolvedValueOnce({ ok: true });
    const reassignment = createEnvelope("WHISPER_CLOSE", "alice", {
      id: "old-whisper",
      updatedAt: 9
    });
    const finalMutation = createEnvelope("WHISPER_CREATE", "alice", {
      id: "new-whisper",
      members: ["alice", "bob"],
      createdBy: "alice",
      createdAt: 10,
      updatedAt: 10
    });

    const result = await publishEnvelopeBatch(
      [reassignment, finalMutation],
      protocol.publish.bind(protocol)
    );

    expect(result).toEqual(failure);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(reassignment);
  });

  it("owns whisper subscriptions, initial request, snapshot response, mutations, and cleanup", async () => {
    const { emit, handlers, protocol, publish, subscribe } = createFakeProtocol();
    const applyEnvelope = vi.fn();
    const getSnapshot = vi.fn(() => ({
      whispers: [{
        id: "whisper-1",
        members: ["alice", "bob"],
        createdBy: "alice",
        createdAt: 1,
        updatedAt: 2
      }],
      spotlightIdentity: "bob"
    }));

    renderHarness({ protocol, applyEnvelope, getSnapshot });
    await act(async () => Promise.resolve());

    expect(subscribe.mock.calls.map(([type]) => type)).toEqual([
      "STATE_REQUEST",
      "STATE_SNAPSHOT",
      "WHISPER_CREATE",
      "WHISPER_UPDATE",
      "WHISPER_CLOSE",
      "SPOTLIGHT_UPDATE"
    ]);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: "STATE_REQUEST", actor: "alice" }));

    await act(async () => {
      emit("STATE_REQUEST", createEnvelope("STATE_REQUEST", "bob", {}));
      await Promise.resolve();
    });
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: "STATE_SNAPSHOT",
      actor: "alice",
      payload: getSnapshot.mock.results[0]?.value
    }));

    const mutation = createEnvelope("WHISPER_CREATE", "bob", {
      id: "whisper-2",
      members: ["bob", "carol"],
      createdBy: "bob",
      createdAt: 3,
      updatedAt: 3
    });
    act(() => emit("WHISPER_CREATE", mutation));
    expect(applyEnvelope).toHaveBeenCalledWith(mutation);

    act(() => root?.unmount());
    expect(Array.from(handlers.values()).every((registered) => registered.size === 0)).toBe(true);
    root = null;
  });

  it("returns publish failures without applying the mutation locally", async () => {
    const failure = { ok: false, reason: "room-unavailable" } as const;
    const { protocol } = createFakeProtocol(failure);
    const applyEnvelope = vi.fn();
    renderHarness({ protocol, applyEnvelope, getSnapshot: () => ({ whispers: [] }) });

    const mutation = createEnvelope("SPOTLIGHT_UPDATE", "alice", {
      identity: "bob",
      updatedAt: 4
    });
    let result: RoomProtocolPublishResult | undefined;
    await act(async () => {
      result = await publishFromHook?.(mutation);
    });

    expect(result).toEqual(failure);
    expect(applyEnvelope).not.toHaveBeenCalled();
  });

  it("applies a successfully published mutation exactly once", async () => {
    const { protocol } = createFakeProtocol();
    const applyEnvelope = vi.fn();
    renderHarness({ protocol, applyEnvelope, getSnapshot: () => ({ whispers: [] }) });

    const mutation = createEnvelope("SPOTLIGHT_UPDATE", "alice", {
      identity: "bob",
      updatedAt: 5
    });
    await act(async () => {
      await publishFromHook?.(mutation);
    });

    expect(applyEnvelope).toHaveBeenCalledTimes(1);
    expect(applyEnvelope).toHaveBeenCalledWith(mutation);
  });
});
