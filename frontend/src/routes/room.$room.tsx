import { createFileRoute } from "@tanstack/react-router";
import { RoomSessionClient } from "@/components/RoomSessionClient";

type RoomSearch = {
  name?: string;
  joinKey?: string;
};

export const Route = createFileRoute("/room/$room")({
  validateSearch: (search: Record<string, unknown>): RoomSearch => ({
    name: typeof search.name === "string" ? search.name : undefined,
    joinKey: typeof search.joinKey === "string" ? search.joinKey : undefined
  }),
  component: RoomPage
});

function RoomPage() {
  const { room } = Route.useParams();
  const search = Route.useSearch();

  const displayName = search.name?.trim() || "Player";
  const joinKey = search.joinKey?.trim() || undefined;

  return (
    <main className="min-h-screen bg-[#0d1214] bg-[radial-gradient(circle_at_top_left,rgba(174,118,57,0.12),transparent_24%),radial-gradient(circle_at_80%_0%,rgba(29,69,63,0.14),transparent_28%),linear-gradient(180deg,#101518_0%,#0c1114_100%)] p-4 md:p-6">
      <RoomSessionClient roomName={room} displayName={displayName} joinKey={joinKey} />
    </main>
  );
}
