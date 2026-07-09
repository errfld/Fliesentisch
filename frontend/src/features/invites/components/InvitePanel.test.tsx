import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitePanel } from "@/features/invites/components/InvitePanel";

const { createInvite, revokeInvite } = vi.hoisted(() => ({
  createInvite: vi.fn(),
  revokeInvite: vi.fn()
}));

vi.mock("@/features/invites/hooks/useInvites", () => ({
  useCampaignInvites: () => ({
    create: createInvite,
    error: null,
    invites: [
      {
        id: 4,
        campaign_id: 7,
        campaign_display_name: "The Ashen Ledger",
        room_slug: "ashen-ledger",
        token_hint: "abcdefgh",
        role: "PLAYER",
        max_uses: 2,
        use_count: 1,
        status: "ACTIVE",
        created_at: "2026-07-09"
      }
    ],
    isLoading: false,
    reload: vi.fn(),
    revoke: revokeInvite
  })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  createInvite.mockReset();
  revokeInvite.mockReset();
});

describe("InvitePanel", () => {
  it("creates a player-only invite and reveals its one-time link", async () => {
    createInvite.mockResolvedValue({
      invite: { id: 5 },
      token: "secret",
      path: "/invite/secret"
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<InvitePanel campaignArchived={false} campaignId={7} />));

    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Create slip");
    await act(async () => button?.click());

    expect(createInvite).toHaveBeenCalledWith({ role: "PLAYER", max_uses: 1 });
    expect((container.querySelector("[aria-label='New invite link']") as HTMLInputElement).value).toContain("/invite/secret");
  });

  it("lists usage and revokes an active invite", async () => {
    revokeInvite.mockResolvedValue(undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<InvitePanel campaignArchived={false} campaignId={7} />));

    expect(container.textContent).toContain("1 of 2 used");
    const revoke = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === "Revoke");
    await act(async () => revoke?.click());
    expect(revokeInvite).toHaveBeenCalledWith(4);
  });
});
