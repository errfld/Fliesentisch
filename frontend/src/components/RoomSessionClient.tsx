import { RoomSession } from "@/components/RoomSession";

type RoomSessionClientProps = {
  roomName: string;
  displayName: string;
  joinKey?: string;
};

export function RoomSessionClient({ roomName, displayName, joinKey }: RoomSessionClientProps) {
  return <RoomSession roomName={roomName} displayName={displayName} joinKey={joinKey} />;
}
