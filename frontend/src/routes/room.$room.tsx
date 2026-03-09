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
    <main className="h-screen overflow-hidden">
      <RoomSessionClient roomName={room} displayName={displayName} joinKey={joinKey} />
    </main>
  );
}
