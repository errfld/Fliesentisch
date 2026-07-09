import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JoinForm } from "@/components/JoinForm";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  navigate.mockReset();
});

describe("JoinForm campaign selection", () => {
  it("joins the selected campaign room", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <JoinForm
          campaigns={[
            {
              id: 1,
              display_name: "Thursday Night",
              room_slug: "thursday-night",
              gamemaster_user_ids: [1],
              player_user_ids: [2],
              default_split_room_names: [],
              is_archived: false,
              created_at: "2026-07-09",
              updated_at: "2026-07-09"
            }
          ]}
          initialName="Alice"
        />
      );
    });

    const select = container.querySelector("select");
    const form = container.querySelector("form");
    expect(select).not.toBeNull();
    expect(form).not.toBeNull();
    act(() => {
      if (select) {
        select.value = "thursday-night";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    act(() => form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(navigate).toHaveBeenCalledWith({
      to: "/room/$room",
      params: { room: "thursday-night" },
      search: { name: "Alice" }
    });
  });
});
