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
      params: { room: room.trim() || "dnd-table-1" },
      search: {
        name: name.trim() || "Player",
        joinKey: joinKey.trim() || undefined
      }
    });
  };

  return (
    <section className="panel w-full max-w-xl">
      <h1 className="text-3xl font-semibold tracking-tight text-accent">DnD Virtual Table</h1>
      <p className="mt-2 text-sm text-slate-300">
        Join the room, then use whisper groups and hold <strong>V</strong> for private side-talk.
      </p>
      <form className="mt-6 space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm">
          Display name
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alice"
            required
          />
        </label>
        <label className="block text-sm">
          Room
          <input
            className="field"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="dnd-table-1"
            required
          />
        </label>
        <label className="block text-sm">
          Join key (optional)
          <input
            className="field"
            value={joinKey}
            onChange={(event) => setJoinKey(event.target.value)}
            placeholder="shared secret"
          />
        </label>
        <button className="btn btn-accent w-full" type="submit">
          Enter Table
        </button>
      </form>
    </section>
  );
}
