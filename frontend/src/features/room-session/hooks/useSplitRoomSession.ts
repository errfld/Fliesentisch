"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnyProtocolEnvelope, SplitState } from "@/lib/protocol";
import { RoomEvent } from "livekit-client";
import type { Participant, Room } from "livekit-client";
import { createEnvelope, parseProtocolEnvelope } from "@/lib/protocol";
import { MAIN_SPLIT_ROOM_ID, MAIN_SPLIT_ROOM_NAME, resolveParticipantRoomId } from "@/features/room-session/lib/session-selectors";
import { createNextSideRoom, createSplitStartState } from "@/features/room-session/lib/split-room-commands";
import {
  canManageSplitAuthority,
  canViewSplitAsGamemaster,
  normalizeSplitRoomName,
  resolveParticipantGameRole,
  shouldAcceptSplitEnvelopeFromSender
} from "@/features/room-session/lib/split-room-rules";
import { selectSplitState, useSplitRoomStore } from "@/features/room-session/store/splitRoomStore";
import type { GameRole } from "@/features/room-session/types";

type UseSplitRoomSessionInput = {
  room: Room | null;
  identity: string;
  gameRole?: GameRole;
  participantIdentities: string[];
};

export function useSplitRoomSession({ room, identity, gameRole, participantIdentities }: UseSplitRoomSessionInput) {
  const isActive = useSplitRoomStore((state) => state.isActive);
  const rooms = useSplitRoomStore((state) => state.rooms);
  const roomOrder = useSplitRoomStore((state) => state.roomOrder);
  const assignments = useSplitRoomStore((state) => state.assignments);
  const gmIdentity = useSplitRoomStore((state) => state.gmIdentity);
  const gmFocusRoomId = useSplitRoomStore((state) => state.gmFocusRoomId);
  const gmBroadcastActive = useSplitRoomStore((state) => state.gmBroadcastActive);
  const updatedAt = useSplitRoomStore((state) => state.updatedAt);
  const applyEnvelope = useSplitRoomStore((state) => state.applyEnvelope);
  const reset = useSplitRoomStore((state) => state.reset);
  const [notice, setNotice] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isPublishingCommand, setIsPublishingCommand] = useState(false);
  const previousRoomIdRef = useRef<string | undefined>(undefined);
  const hasHydratedActiveSplitRef = useRef(false);

  const publishSplitEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, applyLocally = true) => {
      if (!room) {
        return false;
      }

      try {
        const payload = new TextEncoder().encode(JSON.stringify(envelope));
        await room.localParticipant.publishData(payload, { reliable: true });

        if (applyLocally) {
          applyEnvelope(envelope);
        }

        return true;
      } catch {
        return false;
      }
    },
    [applyEnvelope, room]
  );

  const publishManagedEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, failureMessage: string) => {
      setCommandError(null);
      setIsPublishingCommand(true);
      try {
        const didPublish = await publishSplitEnvelope(envelope);
        if (!didPublish) {
          setCommandError(failureMessage);
        }
        return didPublish;
      } finally {
        setIsPublishingCommand(false);
      }
    },
    [publishSplitEnvelope]
  );

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    setCommandError(null);
  }, [identity, room]);

  useEffect(() => {
    if (!room || !identity) {
      reset();
      return;
    }

    const onData = (payload: Uint8Array, participant?: Participant) => {
      const raw = new TextDecoder().decode(payload);
      const envelope = parseProtocolEnvelope(raw);
      if (!envelope) {
        return;
      }

      const senderIdentity = participant?.identity ?? envelope.actor;
      if (envelope.actor !== senderIdentity) {
        return;
      }

      if (envelope.type === "SPLIT_STATE_REQUEST") {
        const currentStore = useSplitRoomStore.getState();
        const splitState = selectSplitState(currentStore);

        if (!splitState.isActive) {
          return;
        }

        const mayReplyToStateRequest = canManageSplitAuthority({
          splitState,
          identity,
          gameRole
        });
        if (!mayReplyToStateRequest) {
          return;
        }

        const snapshot = createEnvelope("SPLIT_STATE_SNAPSHOT", identity, {
          splitState
        });
        void publishSplitEnvelope(snapshot, false);
        return;
      }

      const currentStore = useSplitRoomStore.getState();
      const senderGameRole =
        participant?.identity === senderIdentity
          ? resolveParticipantGameRole(participant.attributes)
          : undefined;

      if (
        !shouldAcceptSplitEnvelopeFromSender({
          currentState: selectSplitState(currentStore),
          envelope,
          senderIdentity,
          senderGameRole
        })
      ) {
        return;
      }

      applyEnvelope(envelope);
    };

    room.on(RoomEvent.DataReceived, onData);

    const stateRequest = createEnvelope("SPLIT_STATE_REQUEST", identity, {});
    void publishSplitEnvelope(stateRequest, false);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [applyEnvelope, gameRole, identity, publishSplitEnvelope, room, reset]);

  const splitState = useMemo<SplitState>(
    () => ({
      isActive,
      rooms: roomOrder
        .map((roomId) => rooms[roomId])
        .filter((room): room is NonNullable<(typeof rooms)[string]> => Boolean(room)),
      assignments,
      gmIdentity,
      gmFocusRoomId,
      gmBroadcastActive,
      updatedAt
    }),
    [assignments, gmBroadcastActive, gmFocusRoomId, gmIdentity, isActive, roomOrder, rooms, updatedAt]
  );

  const canManageThisSplit = canManageSplitAuthority({
    splitState,
    identity,
    gameRole
  });
  const viewerIsGamemaster = canViewSplitAsGamemaster({
    splitState,
    identity,
    gameRole
  });
  const currentRoomId = useMemo(
    () => resolveParticipantRoomId(splitState, identity),
    [identity, splitState]
  );
  const currentRoomName =
    splitState.rooms.find((room) => room.id === currentRoomId)?.name ?? MAIN_SPLIT_ROOM_NAME;

  useEffect(() => {
    if (!identity) {
      previousRoomIdRef.current = undefined;
      hasHydratedActiveSplitRef.current = false;
      setNotice(null);
      return;
    }

    if (!splitState.isActive) {
      const previousRoomId = previousRoomIdRef.current;
      previousRoomIdRef.current = undefined;
      const hadHydratedActiveSplit = hasHydratedActiveSplitRef.current;
      hasHydratedActiveSplitRef.current = false;

      if (!hadHydratedActiveSplit) {
        setNotice(null);
        return;
      }

      if (previousRoomId && previousRoomId !== MAIN_SPLIT_ROOM_ID) {
        setNotice("The table has merged back together.");
        const timer = window.setTimeout(() => setNotice(null), 4000);
        return () => window.clearTimeout(timer);
      }

      setNotice(null);
      return;
    }

    const previousRoomId = previousRoomIdRef.current;
    const isInitialActiveSnapshot = !hasHydratedActiveSplitRef.current;
    hasHydratedActiveSplitRef.current = true;
    previousRoomIdRef.current = currentRoomId;

    if (!isInitialActiveSnapshot && previousRoomId && previousRoomId !== currentRoomId) {
      setNotice(`You were moved to ${currentRoomName}.`);
      const timer = window.setTimeout(() => setNotice(null), 4000);
      return () => window.clearTimeout(timer);
    }

    setNotice(null);
  }, [currentRoomId, currentRoomName, identity, splitState.isActive]);

  const startSplit = useCallback(async () => {
    if (!canManageThisSplit || splitState.isActive) {
      return false;
    }

    const now = Date.now();
    const nextState = createSplitStartState({
      participantIdentities,
      gmIdentity: identity,
      updatedAt: now
    });

    return publishManagedEnvelope(
      createEnvelope("SPLIT_START", identity, { splitState: nextState }),
      "Failed to start split mode while disconnected."
    );
  }, [canManageThisSplit, identity, participantIdentities, publishManagedEnvelope, splitState.isActive]);

  const addRoom = useCallback(async () => {
    if (!canManageThisSplit || !splitState.isActive) {
      return false;
    }

    const now = Date.now();
    const nextRoom = createNextSideRoom(splitState.rooms, now);
    if (!nextRoom) {
      setCommandError("Split mode is limited to three side rooms.");
      return false;
    }
    return publishManagedEnvelope(
      createEnvelope("SPLIT_ROOM_UPSERT", identity, nextRoom),
      "Failed to add a side room while disconnected."
    );
  }, [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive, splitState.rooms]);

  const renameRoom = useCallback(
    async (roomId: string, roomName: string) => {
      if (!canManageThisSplit || !splitState.isActive) {
        return false;
      }

      const existingRoom = splitState.rooms.find((roomEntry) => roomEntry.id === roomId && roomEntry.kind === "side");
      if (!existingRoom || !identity) {
        return false;
      }

      return publishManagedEnvelope(
        createEnvelope("SPLIT_ROOM_UPSERT", identity, {
          ...existingRoom,
          name: normalizeSplitRoomName(roomName, existingRoom.name),
          updatedAt: Date.now()
        }),
        "Failed to rename that side room while disconnected."
      );
    },
    [canManageThisSplit, identity, publishManagedEnvelope, splitState]
  );

  const removeRoom = useCallback(
    async (roomId: string) => {
      if (!canManageThisSplit || !splitState.isActive || roomId === MAIN_SPLIT_ROOM_ID) {
        return false;
      }

      return publishManagedEnvelope(
        createEnvelope("SPLIT_ROOM_REMOVE", identity, {
          roomId,
          updatedAt: Date.now()
        }),
        "Failed to remove the side room while disconnected."
      );
    },
    [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive]
  );

  const assignParticipantToRoom = useCallback(
    async (participantIdentity: string, roomId: string) => {
      if (!canManageThisSplit || !splitState.isActive || !participantIdentity) {
        return false;
      }

      const targetRoomId =
        splitState.rooms.some((roomEntry) => roomEntry.id === roomId) ? roomId : MAIN_SPLIT_ROOM_ID;

      return publishManagedEnvelope(
        createEnvelope("SPLIT_ASSIGNMENT_SET", identity, {
          participantIdentity,
          roomId: targetRoomId,
          updatedAt: Date.now()
        }),
        "Failed to move that participant while disconnected."
      );
    },
    [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive, splitState.rooms]
  );

  const setGmFocusRoom = useCallback(
    async (roomId: string | null) => {
      if (!canManageThisSplit || !splitState.isActive) {
        return false;
      }

      const nextRoomId =
        roomId && splitState.rooms.some((roomEntry) => roomEntry.id === roomId) ? roomId : null;

      return publishManagedEnvelope(
        createEnvelope("SPLIT_GM_FOCUS_UPDATE", identity, {
          roomId: nextRoomId,
          updatedAt: Date.now()
        }),
        "Failed to update GM focus while disconnected."
      );
    },
    [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive, splitState.rooms]
  );

  const setGmBroadcastActive = useCallback(
    async (active: boolean) => {
      if (!canManageThisSplit || !splitState.isActive) {
        return false;
      }

      return publishManagedEnvelope(
        createEnvelope("SPLIT_GM_BROADCAST_UPDATE", identity, {
          active,
          updatedAt: Date.now()
        }),
        "Failed to update GM broadcast while disconnected."
      );
    },
    [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive]
  );

  const endSplit = useCallback(async () => {
    if (!canManageThisSplit || !splitState.isActive) {
      return false;
    }

    return publishManagedEnvelope(
      createEnvelope("SPLIT_END", identity, {
        updatedAt: Date.now()
      }),
      "Failed to merge the table while disconnected."
    );
  }, [canManageThisSplit, identity, publishManagedEnvelope, splitState.isActive]);

  return {
    addRoom,
    assignParticipantToRoom,
    canManageSplitRooms: canManageThisSplit,
    commandError,
    currentRoomId,
    currentRoomName,
    endSplit,
    gmBroadcastActive: splitState.gmBroadcastActive,
    gmFocusRoomId: splitState.gmFocusRoomId,
    isActive: splitState.isActive,
    isPublishingCommand,
    notice,
    renameRoom,
    removeRoom,
    rooms: splitState.rooms,
    setGmBroadcastActive,
    setGmFocusRoom,
    splitState,
    startSplit,
    viewerIsGamemaster
  };
}
