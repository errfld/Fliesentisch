import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteLandingView } from "@/features/invites/components/InviteLanding";
import type { PublicInvite } from "@/features/invites/types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACTIVE_INVITE: PublicInvite = {
  campaign_id: 7,
  campaign_display_name: "The Ashen Ledger",
  room_slug: "ashen-ledger",
  role: "PLAYER",
  status: "ACTIVE"
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function renderView(props: Partial<React.ComponentProps<typeof InviteLandingView>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <InviteLandingView
        invite={ACTIVE_INVITE}
        loading={false}
        redeeming={false}
        redeemed={null}
        token="secret-token"
        {...props}
      />
    );
  });
}

describe("InviteLandingView", () => {
  it("offers auth with the invite path preserved", () => {
    renderView();
    const login = Array.from(container?.querySelectorAll("a") ?? []).find((node) =>
      node.textContent?.includes("Continue with Google")
    );
    expect(login?.getAttribute("href")).toContain("next=%2Finvite%2Fsecret-token");
    expect(container?.textContent).toContain("The Ashen Ledger");
  });

  it("shows a clear revoked state", () => {
    renderView({ invite: { ...ACTIVE_INVITE, status: "REVOKED" } });
    expect(container?.textContent).toContain("revoked by its gamemaster");
    expect(container?.textContent).not.toContain("Continue with Google");
  });

  it("links a redeemed player directly to the campaign room", () => {
    renderView({
      redeemed: {
        campaign_id: 7,
        campaign_display_name: "The Ashen Ledger",
        room_slug: "ashen-ledger"
      },
      user: {
        id: 9,
        email: "guest@example.com",
        display_name: "Guest",
        platform_role: "USER",
        game_role: "PLAYER"
      }
    });
    expect(container?.textContent).toContain("Seat confirmed");
    expect(container?.textContent).toContain("Enter The Ashen Ledger");
  });
});
