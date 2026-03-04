import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { useWhisperPtt } from "@/hooks/useWhisperPtt";

// Required by React to suppress warnings when using act() in Vitest.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  enabled: boolean;
  keyCode?: string;
  onPress: () => void;
  onRelease: () => void;
};

function Harness({ enabled, keyCode, onPress, onRelease }: HarnessProps) {
  useWhisperPtt({ enabled, keyCode, onPress, onRelease });
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHarness(props: HarnessProps): void {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(<Harness {...props} />);
  });
}

function cleanup(): void {
  act(() => {
    root?.unmount();
  });
  root = null;
  if (container) {
    container.remove();
  }
  container = null;
}

afterEach(() => {
  cleanup();
});

describe("useWhisperPtt", () => {
  it("triggers onPress once per key hold and onRelease on keyup", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHarness({ enabled: true, onPress, onRelease });

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV" }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while focused in a form field", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHarness({ enabled: true, onPress, onRelease });

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyV", bubbles: true }));
    input.remove();

    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("supports custom key bindings", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderHarness({ enabled: true, keyCode: "KeyG", onPress, onRelease });

    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyV" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyG" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyG" }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
