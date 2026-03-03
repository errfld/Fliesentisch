"use client";

import dynamic from "next/dynamic";

type RoomSessionClientProps = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

const RoomSessionNoSsr = dynamic(
  () => import("@/components/RoomSession").then((module) => module.RoomSession),
  {
    ssr: false,
    loading: () => <div className="panel">Loading room...</div>
  }
);

export function RoomSessionClient({ roomName, displayName, joinKey }: RoomSessionClientProps) {
  return <RoomSessionNoSsr roomName={roomName} displayName={displayName} joinKey={joinKey} />;
}
