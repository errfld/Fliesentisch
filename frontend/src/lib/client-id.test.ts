import { afterEach, describe, expect, it, vi } from "vitest";
import { createUuid, getOrCreateClientId, toIdentity } from "@/lib/client-id";

const STORAGE_KEY = "virtual-table-client-id";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("createUuid", () => {
  it("uses crypto.randomUUID when available", () => {
    const randomUuid = vi
      .spyOn(window.crypto, "randomUUID")
      .mockReturnValue("11111111-1111-4111-8111-111111111111");

    expect(createUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUuid).toHaveBeenCalledTimes(1);
  });

  it("falls back to random bytes when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((input: Uint8Array) => {
      for (let index = 0; index < input.length; index += 1) {
        input[index] = index;
      }
      return input;
    });

    vi.stubGlobal("window", {
      crypto: {
        getRandomValues
      }
    });

    const result = createUuid();

    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("getOrCreateClientId", () => {
  it("returns persisted client id when present", () => {
    window.localStorage.setItem(STORAGE_KEY, "existing-id");

    expect(getOrCreateClientId()).toBe("existing-id");
  });

  it("creates and stores a new client id when none exists", () => {
    vi.spyOn(window.crypto, "randomUUID").mockReturnValue("22222222-2222-4222-8222-222222222222");

    const created = getOrCreateClientId();

    expect(created).toBe("22222222-2222-4222-8222-222222222222");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(created);
  });

  it("returns server identity when window is unavailable", () => {
    vi.stubGlobal("window", undefined);

    expect(getOrCreateClientId()).toBe("server");
  });
});

describe("toIdentity", () => {
  it("normalizes display name and appends stable entropy suffix", () => {
    const identity = toIdentity("  Sir Bob!!!  ", "ABCD-1234-EFGH-5678");

    expect(identity).toBe("sir-bob-1234efgh5678");
  });

  it("falls back to player slug and zero entropy when inputs are empty", () => {
    expect(toIdentity("  ", "***")).toBe("player-000000000000");
  });
});
