import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { JoinForm } from "@/components/JoinForm";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";

const DEFAULT_ROOM = import.meta.env.VITE_DEFAULT_ROOM?.trim() || "dnd-table-1";
const DEFAULT_JOIN_KEY = import.meta.env.VITE_JOIN_KEY?.trim() || "";

export function JoinFormController() {
  const navigate = useNavigate({ from: "/" });
  const auth = useAuthSession();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [room, setRoom] = useState(DEFAULT_ROOM);
  const [joinKey, setJoinKey] = useState(DEFAULT_JOIN_KEY);
  const [authBusy, setAuthBusy] = useState(false);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    void navigate({
      to: "/room/$room",
      params: { room: room.trim() || DEFAULT_ROOM },
      search: {
        name: name.trim() || "Player",
        joinKey: auth.isAuthenticated ? undefined : joinKey.trim() || undefined
      }
    });
  };

  const onSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthBusy(true);
    try {
      await auth.login(email.trim());
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <JoinForm
      authBusy={authBusy}
      authError={auth.error}
      authIsLoading={auth.isLoading}
      authSession={
        auth.session
          ? {
              email: auth.session.email,
              gameRole: auth.session.game_role,
              platformRole: auth.session.platform_role
            }
          : null
      }
      email={email}
      isAuthenticated={auth.isAuthenticated}
      joinKey={joinKey}
      name={name}
      onChangeEmail={setEmail}
      onChangeJoinKey={setJoinKey}
      onChangeName={setName}
      onChangeRoom={setRoom}
      onSignIn={onSignIn}
      onSignOut={() => void auth.logout()}
      onSubmit={onSubmit}
      room={room}
    />
  );
}
