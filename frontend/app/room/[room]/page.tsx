import { RoomSessionClient } from "@/components/RoomSessionClient";

type RoomPageProps = {
  params: Promise<{ room: string }>;
  searchParams: Promise<{ name?: string | string[]; joinKey?: string | string[] }>;
};

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function RoomPage({ params, searchParams }: RoomPageProps) {
  const [{ room }, query] = await Promise.all([params, searchParams]);
  const displayName = firstParam(query.name) ?? "Player";
  const joinKey = firstParam(query.joinKey);

  return (
    <main className="min-h-screen bg-gradient-to-b from-canvas via-[#111722] to-[#0a0d13] p-4 md:p-6">
      <RoomSessionClient roomName={room} displayName={displayName} joinKey={joinKey} />
    </main>
  );
}
