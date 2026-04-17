import { RoomSessionController } from "@/features/room-session/components/RoomSessionController";

type RoomSessionProps = {
  roomName: string;
  displayName: string;
};

export function RoomSession({ roomName, displayName }: RoomSessionProps) {
  return <RoomSessionController roomName={roomName} displayName={displayName} />;
}
