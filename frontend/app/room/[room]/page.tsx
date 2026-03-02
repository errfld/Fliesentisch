import { RoomSession } from "@/components/RoomSession";

type RoomPageProps = {
  params: { room: string };
  searchParams: { name?: string; joinKey?: string };
};

export default function RoomPage({ params, searchParams }: RoomPageProps) {
  const displayName = searchParams.name ?? "Player";
  const joinKey = searchParams.joinKey;

  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-[#111722] to-[#0a0d13] p-4 md:p-6">
      <RoomSession roomName={params.room} displayName={displayName} joinKey={joinKey} />
    </main>
  );
}
