import { RoomSession } from "@/features/room-session/components/RoomSession";

type RoomSessionClientProps = {
  roomName: string;
  displayName: string;
};

export function RoomSessionClient({ roomName, displayName }: RoomSessionClientProps) {
  return <RoomSession roomName={roomName} displayName={displayName} />;
}
