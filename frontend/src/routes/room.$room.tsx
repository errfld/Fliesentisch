import { createFileRoute } from "@tanstack/react-router";
import { RoomSessionController } from "@/features/room-session/components/RoomSessionController";

type RoomSearch = {
  name?: string;
};

export const Route = createFileRoute("/room/$room")({
  validateSearch: (search: Record<string, unknown>): RoomSearch => ({
    name: typeof search.name === "string" ? search.name : undefined
  }),
  component: RoomPage
});

function RoomPage() {
  const { room } = Route.useParams();
  const search = Route.useSearch();

  const displayName = search.name?.trim() || "Player";

  return (
    <main className="h-screen overflow-hidden">
      <RoomSessionController roomName={room} displayName={displayName} />
    </main>
  );
}
