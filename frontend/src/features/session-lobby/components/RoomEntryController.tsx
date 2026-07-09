import { useState } from "react";
import { RoomSessionController } from "@/features/room-session/components/RoomSessionController";
import { RoomSessionState } from "@/features/room-session/components/RoomSessionState";
import { useRoomConnection } from "@/features/room-session/hooks/useRoomConnection";
import { SessionLobby } from "@/features/session-lobby/components/SessionLobby";

export function RoomEntryController({ roomName, displayName }: { roomName: string; displayName: string }) {
  const [entered, setEntered] = useState(false);
  return entered ? (
    <LiveTableConnection roomName={roomName} displayName={displayName} />
  ) : (
    <LobbyConnection roomName={roomName} displayName={displayName} onEnter={() => setEntered(true)} />
  );
}

function LobbyConnection({ roomName, displayName, onEnter }: { roomName: string; displayName: string; onEnter: () => void }) {
  const connection = useRoomConnection({ roomName, displayName, purpose: "lobby" });

  if (connection.isConnecting) {
    return <RoomSessionState title="Opening the lobby" message="Connecting to the preflight room..." />;
  }
  if (connection.error) {
    return <RoomSessionState title="Lobby unavailable" message={connection.error} tone="error" />;
  }
  if (!connection.room) {
    return <RoomSessionState title="Lobby unavailable" message="Room is not connected." tone="error" />;
  }
  return <SessionLobby connection={connection} displayName={displayName} roomName={roomName} onEnter={onEnter} />;
}

function LiveTableConnection({ roomName, displayName }: { roomName: string; displayName: string }) {
  const connection = useRoomConnection({ roomName, displayName });
  return <RoomSessionController connection={connection} roomName={roomName} displayName={displayName} />;
}
