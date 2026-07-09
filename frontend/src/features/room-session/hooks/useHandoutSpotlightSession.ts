"use client";

import { useCallback, useEffect, useState } from "react";
import type { Room } from "livekit-client";
import type {
  AnyProtocolEnvelope,
  HandoutSpotlightStatePayload
} from "@/lib/protocol";
import { createEnvelope } from "@/lib/protocol";
import type {
  RoomProtocol,
  RoomProtocolMessageContext
} from "@/features/room-session/lib/room-protocol";
import {
  canManageHandoutSpotlight,
  normalizeHandoutImageUrl,
  normalizeHandoutTitle,
  resolveHandoutPresenterRole,
  resolveParticipantAuthorityRoles,
  shouldAcceptHandoutEnvelopeFromSender
} from "@/features/room-session/lib/handout-spotlight-rules";
import { useHandoutSpotlightStore } from "@/features/room-session/store/handoutSpotlightStore";
import type { CommandResult, GameRole, PlatformRole } from "@/features/room-session/types";

type UseHandoutSpotlightSessionInput = {
  room: Room | null;
  protocol: RoomProtocol;
  identity: string;
  gameRole?: GameRole;
  platformRole?: PlatformRole;
};

export function useHandoutSpotlightSession({
  room,
  protocol,
  identity,
  gameRole,
  platformRole
}: UseHandoutSpotlightSessionInput) {
  const handout = useHandoutSpotlightStore((state) => state.handout);
  const updatedAt = useHandoutSpotlightStore((state) => state.updatedAt);
  const applyEnvelope = useHandoutSpotlightStore((state) => state.applyEnvelope);
  const reset = useHandoutSpotlightStore((state) => state.reset);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  const canManage = canManageHandoutSpotlight({ gameRole, platformRole });
  const presenterRole = resolveHandoutPresenterRole({ gameRole, platformRole });

  const publishEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, applyLocally = true) => {
      const result = await protocol.publish(envelope);
      if (!result.ok) {
        return false;
      }
      if (applyLocally) {
        applyEnvelope(envelope);
      }
      return true;
    },
    [applyEnvelope, protocol]
  );

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    setCommandError(null);
    setIsMinimized(false);
    if (!room || !identity) {
      reset();
    }
  }, [identity, reset, room]);

  useEffect(() => {
    if (!handout) {
      setIsMinimized(false);
    }
  }, [handout]);

  useEffect(() => {
    if (!room || !identity) {
      return;
    }

    const onStateRequest = (
      envelope: Extract<AnyProtocolEnvelope, { type: "HANDOUT_STATE_REQUEST" }>,
      { senderIdentity }: RoomProtocolMessageContext
    ) => {
      if (envelope.actor !== senderIdentity || !canManage) {
        return;
      }

      const currentState = useHandoutSpotlightStore.getState();
      if (currentState.updatedAt === 0) {
        return;
      }
      const snapshot = createEnvelope("HANDOUT_STATE_SNAPSHOT", identity, {
        handout: currentState.handout ?? null,
        updatedAt: currentState.updatedAt
      });
      void publishEnvelope(snapshot, false);
    };

    const onStateEnvelope = (
      envelope: Extract<
        AnyProtocolEnvelope,
        { type: "HANDOUT_STATE_SNAPSHOT" | "HANDOUT_SPOTLIGHT_UPDATE" }
      >,
      { participant, senderIdentity }: RoomProtocolMessageContext
    ) => {
      if (!participant || envelope.actor !== senderIdentity || participant.identity !== senderIdentity) {
        return;
      }

      const roles = resolveParticipantAuthorityRoles(participant.attributes);
      if (!shouldAcceptHandoutEnvelopeFromSender({ envelope, senderIdentity, ...roles })) {
        return;
      }
      applyEnvelope(envelope);
    };

    const unsubscribers = [
      protocol.subscribe("HANDOUT_STATE_REQUEST", onStateRequest),
      protocol.subscribe("HANDOUT_STATE_SNAPSHOT", onStateEnvelope),
      protocol.subscribe("HANDOUT_SPOTLIGHT_UPDATE", onStateEnvelope)
    ];
    void publishEnvelope(createEnvelope("HANDOUT_STATE_REQUEST", identity, {}), false);

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [applyEnvelope, canManage, identity, protocol, publishEnvelope, room]);

  const publishState = useCallback(
    async (payload: HandoutSpotlightStatePayload, failureMessage: string): Promise<CommandResult> => {
      setCommandError(null);
      setIsPublishing(true);
      try {
        const didPublish = await publishEnvelope(
          createEnvelope("HANDOUT_SPOTLIGHT_UPDATE", identity, payload)
        );
        if (!didPublish) {
          setCommandError(failureMessage);
        }
        return didPublish ? { ok: true } : { ok: false };
      } finally {
        setIsPublishing(false);
      }
    },
    [identity, publishEnvelope]
  );

  const broadcastHandout = useCallback(
    async (imageUrlInput: string, titleInput: string): Promise<CommandResult> => {
      if (!canManage || !presenterRole || !identity) {
        setCommandError("Only a gamemaster or platform admin can present a handout.");
        return { ok: false };
      }

      const imageUrl = normalizeHandoutImageUrl(imageUrlInput);
      if (!imageUrl) {
        setCommandError("Enter a complete http:// or https:// image URL.");
        return { ok: false };
      }
      const nextUpdatedAt = Math.max(Date.now(), useHandoutSpotlightStore.getState().updatedAt + 1);
      return publishState(
        {
          handout: {
            imageUrl,
            title: normalizeHandoutTitle(titleInput),
            presenterIdentity: identity,
            presenterRole,
            updatedAt: nextUpdatedAt
          },
          updatedAt: nextUpdatedAt
        },
        "The handout could not be broadcast while disconnected."
      );
    },
    [canManage, identity, presenterRole, publishState]
  );

  const stopHandout = useCallback(async (): Promise<CommandResult> => {
    if (!canManage || !identity) {
      setCommandError("Only a gamemaster or platform admin can stop a handout.");
      return { ok: false };
    }
    const nextUpdatedAt = Math.max(Date.now(), useHandoutSpotlightStore.getState().updatedAt + 1);
    return publishState(
      { handout: null, updatedAt: nextUpdatedAt },
      "The handout could not be stopped while disconnected."
    );
  }, [canManage, identity, publishState]);

  return {
    handout,
    updatedAt,
    canManage,
    isMinimized,
    isPublishing,
    commandError,
    broadcastHandout,
    stopHandout,
    minimize: () => setIsMinimized(true),
    restore: () => setIsMinimized(false)
  };
}
