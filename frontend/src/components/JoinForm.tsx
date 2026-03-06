import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

const DEFAULT_ROOM = import.meta.env.VITE_DEFAULT_ROOM ?? "dnd-table-1";
const DEFAULT_JOIN_KEY = import.meta.env.VITE_JOIN_KEY ?? "";

export function JoinForm() {
  const navigate = useNavigate({ from: "/" });
  const [name, setName] = useState("");
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [joinKey, setJoinKey] = useState(DEFAULT_JOIN_KEY);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    void navigate({
      to: "/room/$room",
      params: { room: room.trim() || DEFAULT_ROOM },
      search: {
        name: name.trim() || "Player",
        joinKey: joinKey.trim() || undefined
      }
    });
  };

  return (
    <section className="w-full max-w-sm">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--c-text-faint)]">Enter the room</p>
      <h1 className="display-face mt-2 text-2xl text-[var(--c-text-warm)]">Join the table</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--c-text-dim)]">
        Choose the name your group knows you by and step into the room. Whispers and spotlight stay inside.
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
        <label className="block text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-dim)]">
          Join key
          <input
            className="field"
            value={joinKey}
            onChange={(event) => setJoinKey(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <button className="chip mt-4 w-full justify-center py-2.5 text-xs" type="submit">
          Enter table
        </button>
      </form>
    </section>
  );
}
