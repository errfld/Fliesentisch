import { describe, expect, it } from "vitest";
import { normalizeGameRole } from "@/features/room-session/hooks/useRoomConnection";

describe("normalizeGameRole", () => {
  it("accepts backend enum JSON and protocol-style role values", () => {
    expect(normalizeGameRole("GAMEMASTER")).toBe("gamemaster");
    expect(normalizeGameRole("PLAYER")).toBe("player");
    expect(normalizeGameRole("gamemaster")).toBe("gamemaster");
    expect(normalizeGameRole("player")).toBe("player");
    expect(normalizeGameRole("admin")).toBeUndefined();
  });
});
