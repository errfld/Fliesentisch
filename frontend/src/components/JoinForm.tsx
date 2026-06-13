import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

const DEFAULT_ROOM = import.meta.env.VITE_DEFAULT_ROOM ?? "dnd-table-1";

type JoinFormProps = {
  initialName?: string;
};

export function JoinForm({ initialName = "" }: JoinFormProps) {
  const navigate = useNavigate({ from: "/" });
  const [name, setName] = useState(initialName);
  const [room, setRoom] = useState(DEFAULT_ROOM);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    void navigate({
      to: "/room/$room",
      params: { room: room.trim() || DEFAULT_ROOM },
      search: {
        name: name.trim() || "Player"
      }
    });
  };

  return (
    <section className="w-full max-w-sm">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Almost there</p>
      <h1 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Join the room</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--c-text-dim)]">
        Pick the name we'll recognize. Leave the room as-is unless someone gave you a different one.
      </p>
      <form className="mt-8 space-y-6" onSubmit={onSubmit}>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Display name
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alice"
            required
          />
        </label>
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Room
          <input
            className="field"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="dnd-table-1"
            required
          />
        </label>
        <button className="chip mt-4 w-full justify-center py-2.5 text-xs" type="submit">
          Enter table
        </button>
      </form>
    </section>
  );
}
