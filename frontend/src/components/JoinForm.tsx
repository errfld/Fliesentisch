"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function JoinForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [room, setRoom] = useState(process.env.NEXT_PUBLIC_DEFAULT_ROOM ?? "dnd-table-1");
  const [joinKey, setJoinKey] = useState(process.env.NEXT_PUBLIC_JOIN_KEY ?? "");

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams({ name: name.trim() || "Player" });
    if (joinKey.trim()) {
      params.set("joinKey", joinKey.trim());
    }
    router.push(`/room/${encodeURIComponent(room.trim() || "dnd-table-1")}?${params.toString()}`);
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
