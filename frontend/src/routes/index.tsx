import { createFileRoute } from "@tanstack/react-router";
import { JoinFormController } from "@/features/auth/components/JoinFormController";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return (
    <main className="flex min-h-screen items-center bg-[var(--c-void)]">
      <div className="mx-auto grid w-full max-w-6xl gap-16 px-8 py-12 lg:grid-cols-[1fr_320px] lg:items-center lg:gap-24">
        {/* Left — editorial hero */}
        <section>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--c-text-faint)]">
            For one campaign group, around one shared table
          </p>
          <h1 className="display-face mt-4 max-w-2xl text-5xl leading-[1.02] text-[var(--c-text-warm)] md:text-6xl">
            Virtual Table
          </h1>
          <p className="mt-6 max-w-lg text-base leading-7 text-[var(--c-text-dim)]">
            Built around the parts that matter in play: seeing the person who has the floor, breaking off into
            whispers without chaos, and keeping the room calm on a wide screen.
          </p>

          {/* Feature trio — no boxes, just a typographic grid */}
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Spotlight</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                The active speaker gets the space. Everyone else stays present, but secondary.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Whispers</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Side-talk stays private and lightweight instead of turning the room into panels.
              </p>
            </div>
            <div>
              <h2 className="display-face text-base text-[var(--c-text-warm)]">Widescreen</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--c-text-dim)]">
                Most of the screen belongs to the table itself, not to controls explaining themselves.
              </p>
            </div>
          </div>

          {/* Keys — inline, no badge boxes */}
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--c-rule)] pt-5 text-[11px] text-[var(--c-text-faint)]">
            <span>
              Hold <kbd className="font-mono text-[var(--c-text-dim)]">V</kbd> for whisper push-to-talk
            </span>
            <span>
              Press <kbd className="font-mono text-[var(--c-text-dim)]">G</kbd> to leave a whisper
            </span>
          </div>
        </section>

        {/* Right — join form */}
        <JoinFormController />
      </div>
    </main>
  );
}
