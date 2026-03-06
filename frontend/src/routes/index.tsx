import { createFileRoute } from "@tanstack/react-router";
import { JoinForm } from "@/components/JoinForm";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,1.1fr)_430px]">
        <section className="rounded-[28px] border border-[#33413f] bg-[#12191c]/88 p-7 shadow-[0_32px_90px_rgba(0,0,0,0.35)] md:p-10">
          <p className="text-sm text-[#c4cdc7]">For one campaign group, around one shared table.</p>
          <h1 className="display-face mt-4 max-w-3xl text-5xl leading-[1.02] text-[#f1e5d1] md:text-6xl">
            Virtual Table
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[#b5c1ba]">
            Built around the parts that matter in play: seeing the person who has the floor, breaking off into
            whispers without chaos, and keeping the room calm on a wide screen.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <section className="rounded-[20px] border border-[#344342] bg-[#0f1518]/82 p-5">
              <h2 className="display-face text-2xl text-[#f0debf]">Spotlight</h2>
              <p className="mt-2 text-sm leading-6 text-[#afbbb5]">
                The active speaker or scene gets the space. Everyone else stays present, but secondary.
              </p>
            </section>
            <section className="rounded-[20px] border border-[#344342] bg-[#0f1518]/82 p-5">
              <h2 className="display-face text-2xl text-[#f0debf]">Whispers</h2>
              <p className="mt-2 text-sm leading-6 text-[#afbbb5]">
                Side-talk stays private and lightweight instead of turning the room into a pile of panels.
              </p>
            </section>
            <section className="rounded-[20px] border border-[#344342] bg-[#0f1518]/82 p-5">
              <h2 className="display-face text-2xl text-[#f0debf]">Widescreen</h2>
              <p className="mt-2 text-sm leading-6 text-[#afbbb5]">
                Most of the screen belongs to the table itself, not to controls explaining themselves.
              </p>
            </section>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 border-t border-[#2f3a39] pt-5 text-sm text-[#9dacaa]">
            <span>
              Hold <span className="rounded-md border border-[#495552] bg-[#11181b] px-1.5 py-0.5 font-mono text-[#ead9ba]">V</span>{" "}
              for whisper push-to-talk.
            </span>
            <span>
              Press <span className="rounded-md border border-[#495552] bg-[#11181b] px-1.5 py-0.5 font-mono text-[#ead9ba]">G</span>{" "}
              to leave a whisper.
            </span>
            <span>Camera and mic stay with you inside the room.</span>
          </div>
        </section>

        <JoinForm />
      </div>
    </main>
  );
}
