import { RoomSessionController } from "@/features/room-session/components/RoomSessionController";

type RoomSessionProps = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

export function RoomSession({ roomName, displayName, joinKey }: RoomSessionProps) {
  return <RoomSessionController roomName={roomName} displayName={displayName} joinKey={joinKey} />;
}
