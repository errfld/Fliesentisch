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
    <section className="w-full rounded-[28px] border border-[#4a5b58] bg-[#161f22]/92 p-6 shadow-[0_28px_80px_rgba(0,0,0,0.38)]">
      <div className="border-b border-[#34413f] pb-5">
        <p className="text-sm text-[#c1cbc5]">Enter the room</p>
        <h1 className="display-face mt-3 text-3xl leading-tight text-[#f0e3cd]">Join the table</h1>
        <p className="mt-3 text-sm leading-6 text-[#b3bfba]">
          Choose the name your group knows you by and step into the room. Whispers and spotlight stay inside.
        </p>
      </div>
      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <label className="block text-sm text-[#dde4df]">
          Display name
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alice"
            required
          />
        </label>
        <label className="block text-sm text-[#dde4df]">
          Room
          <input
            className="field"
            value={room}
            onChange={(event) => setRoom(event.target.value)}
            placeholder="dnd-table-1"
            required
          />
        </label>
        <label className="block text-sm text-[#dde4df]">
          Join key
          <input
            className="field"
            value={joinKey}
            onChange={(event) => setJoinKey(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <button className="btn btn-accent mt-2 w-full justify-center" type="submit">
          Enter table
        </button>
      </form>
    </section>
  );
}
