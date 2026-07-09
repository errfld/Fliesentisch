"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { RoomEvent } from "livekit-client";
import type { Participant, Room } from "livekit-client";
import {
  createRoomProtocolRouter,
  publishRoomProtocolEnvelope
} from "@/features/room-session/lib/room-protocol";
import type {
  RoomProtocol,
  RoomProtocolRouter
} from "@/features/room-session/lib/room-protocol";

export function useRoomProtocol(room: Room | null): RoomProtocol {
  const routerRef = useRef<RoomProtocolRouter | null>(null);
  if (!routerRef.current) {
    routerRef.current = createRoomProtocolRouter();
  }
  const router = routerRef.current;

  useEffect(() => {
    if (!room) {
      return;
    }

    const onData = (payload: Uint8Array, participant?: Participant) => {
      router.route(payload, participant);
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [room, router]);

  const publish: RoomProtocol["publish"] = useCallback(
    (envelope) => publishRoomProtocolEnvelope(room, envelope),
    [room]
  );

  return useMemo(
    () => ({
      publish,
      subscribe: router.subscribe
    }),
    [publish, router]
  );
}
