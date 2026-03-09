"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RoomEvent, Track } from "livekit-client";
import type { Room } from "livekit-client";
import { createUuid } from "@/lib/client-id";
import {
  createEnvelope,
  parseProtocolEnvelope
} from "@/lib/protocol";
import type { AnyProtocolEnvelope, SpotlightPayload, Whisper, WhisperClosePayload } from "@/lib/protocol";
import { useWhisperPtt } from "@/hooks/useWhisperPtt";
import { collectReassignmentMutations } from "@/lib/whisper-membership";
import { useWhisperStore } from "@/store/whisperStore";

type UseWhisperSessionInput = {
  room: Room | null;
  identity: string;
  renderVersion: number;
  startWhisperPtt: (whisperId: string) => Promise<void>;
  stopWhisperPtt: () => Promise<void>;
  clearWhisperTrack: () => Promise<void>;
};

export function useWhisperSession({
  room,
  identity,
  renderVersion,
  startWhisperPtt,
  stopWhisperPtt,
  clearWhisperTrack
}: UseWhisperSessionInput) {
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());
  const [whisperNotice, setWhisperNotice] = useState<string | null>(null);

  const whispers = useWhisperStore((state) => state.whispers);
  const selectedWhisperId = useWhisperStore((state) => state.selectedWhisperId);
  const mainVolume = useWhisperStore((state) => state.mainVolume);
  const spotlightIdentity = useWhisperStore((state) => state.spotlightIdentity);
  const followSpotlight = useWhisperStore((state) => state.followSpotlight);
  const setLocalIdentity = useWhisperStore((state) => state.setLocalIdentity);
  const setSelectedWhisperId = useWhisperStore((state) => state.setSelectedWhisperId);
  const setFollowSpotlight = useWhisperStore((state) => state.setFollowSpotlight);
  const applyEnvelope = useWhisperStore((state) => state.applyEnvelope);

  const selectedWhisper = selectedWhisperId ? whispers[selectedWhisperId] : undefined;
  const isSelectedMember = Boolean(selectedWhisper && selectedWhisper.members.includes(identity));
  const selectedParticipants = useMemo(
    () => Array.from(selectedParticipantIds).sort((a, b) => a.localeCompare(b)),
    [selectedParticipantIds]
  );
  const activeWhispers = useMemo(
    () => Object.values(whispers).sort((a, b) => b.updatedAt - a.updatedAt),
    [whispers]
  );

  useEffect(() => {
    if (identity) {
      setLocalIdentity(identity);
    }
  }, [identity, setLocalIdentity]);

  const publishEnvelope = useCallback(
    async (envelope: AnyProtocolEnvelope, applyLocally = true) => {
      if (applyLocally) {
        applyEnvelope(envelope);
      }
      if (!room) {
        return;
      }

      const payload = new TextEncoder().encode(JSON.stringify(envelope));
      await room.localParticipant.publishData(payload, { reliable: true });
    },
    [applyEnvelope, room]
  );

  useEffect(() => {
    if (!room || !identity) {
      return;
    }

    const onData = (payload: Uint8Array) => {
      const raw = new TextDecoder().decode(payload);
      const envelope = parseProtocolEnvelope(raw);
      if (!envelope) {
        return;
      }

      if (envelope.type === "STATE_REQUEST") {
        const snapshot = createEnvelope("STATE_SNAPSHOT", identity, {
          whispers: Object.values(useWhisperStore.getState().whispers),
          spotlightIdentity: useWhisperStore.getState().spotlightIdentity ?? null
        });
        void publishEnvelope(snapshot, false);
        return;
      }

      applyEnvelope(envelope);
    };

    room.on(RoomEvent.DataReceived, onData);

    const stateRequest = createEnvelope("STATE_REQUEST", identity, {});
    void publishEnvelope(stateRequest, false);

    return () => {
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [applyEnvelope, identity, publishEnvelope, room]);

  useEffect(() => {
    if (!room) {
      setSelectedParticipantIds(new Set());
      return;
    }

    const connectedIdentities = new Set(Array.from(room.remoteParticipants.keys()));
    setSelectedParticipantIds((current) => {
      const filtered = Array.from(current).filter((participantId) => connectedIdentities.has(participantId));
      if (filtered.length === current.size) {
        return current;
      }
      return new Set(filtered);
    });
  }, [renderVersion, room]);

  const applySelectiveSubscriptions = useCallback(() => {
    if (!room) {
      return;
    }

    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.kind !== Track.Kind.Audio) {
          return;
        }

        const trackName = publication.trackName ?? "";
        if (trackName === "main") {
          publication.setSubscribed(true);
          return;
        }

        if (trackName.startsWith("whisper:")) {
          const whisperId = trackName.slice("whisper:".length);
          const isMember = whispers[whisperId]?.members.includes(identity) ?? false;
          publication.setSubscribed(isMember);
          return;
        }

        publication.setSubscribed(true);
      });
    });
  }, [identity, room, whispers]);

  useEffect(() => {
    applySelectiveSubscriptions();
  }, [applySelectiveSubscriptions]);

  useEffect(() => {
    if (room && selectedWhisperId) {
      return;
    }

    void clearWhisperTrack();
  }, [clearWhisperTrack, room, selectedWhisperId]);

  const toggleParticipantSelection = useCallback(
    (participantIdentity: string) => {
      if (!participantIdentity || participantIdentity === identity) {
        return;
      }
      setSelectedParticipantIds((current) => {
        const next = new Set(current);
        if (next.has(participantIdentity)) {
          next.delete(participantIdentity);
        } else {
          next.add(participantIdentity);
        }
        return next;
      });
    },
    [identity]
  );

  const publishReassignmentMutations = useCallback(
    async (targetWhisperId: string, movedMembers: string[], updatedAt: number) => {
      if (!identity) {
        return;
      }

      const mutations = collectReassignmentMutations(whispers, targetWhisperId, movedMembers, updatedAt);
      for (const mutation of mutations) {
        if (mutation.type === "close") {
          await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, mutation.payload));
          continue;
        }
        await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, mutation.whisper));
      }
    },
    [identity, publishEnvelope, whispers]
  );

  const createWhisper = useCallback(async () => {
    if (!identity) {
      return;
    }

    if (selectedParticipants.length === 0) {
      setWhisperNotice("Select one or more participants from the video tiles first.");
      return;
    }

    const id = createUuid();
    const now = Date.now();
    const members = Array.from(new Set([identity, ...selectedParticipants]));
    const reassignmentMutations = collectReassignmentMutations(whispers, id, members, now);
    const projectedWhisperCount =
      Object.keys(whispers).length -
      reassignmentMutations.filter((mutation) => mutation.type === "close").length +
      1;
    if (projectedWhisperCount > 3) {
      setWhisperNotice("Only three active whispers are allowed.");
      return;
    }

    await publishReassignmentMutations(id, members, now);

    const whisper: Whisper = {
      id,
      members,
      createdBy: identity,
      createdAt: now,
      updatedAt: now
    };

    await publishEnvelope(createEnvelope("WHISPER_CREATE", identity, whisper));
    setSelectedWhisperId(id);
    setSelectedParticipantIds(new Set());
    setWhisperNotice(null);
  }, [identity, publishEnvelope, publishReassignmentMutations, selectedParticipants, setSelectedWhisperId, whispers]);

  const joinWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const now = Date.now();
      await publishReassignmentMutations(whisper.id, [identity], now);

      const updated: Whisper = {
        ...whisper,
        members: Array.from(new Set([...whisper.members, identity])),
        updatedAt: now
      };

      await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      setSelectedWhisperId(whisper.id);
      setWhisperNotice(null);
    },
    [identity, publishEnvelope, publishReassignmentMutations, setSelectedWhisperId]
  );

  const addSelectedParticipantsToWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity || !whisper.members.includes(identity)) {
        return;
      }

      const participantsToAdd = selectedParticipants.filter((participantId) => !whisper.members.includes(participantId));
      if (participantsToAdd.length === 0) {
        setWhisperNotice("No additional selected participants to add.");
        return;
      }

      const now = Date.now();
      await publishReassignmentMutations(whisper.id, participantsToAdd, now);

      const updated: Whisper = {
        ...whisper,
        members: Array.from(new Set([...whisper.members, ...participantsToAdd])),
        updatedAt: now
      };

      await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      setSelectedParticipantIds(new Set());
      setWhisperNotice(null);
    },
    [identity, publishEnvelope, publishReassignmentMutations, selectedParticipants]
  );

  const leaveWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const remaining = whisper.members.filter((member) => member !== identity);
      if (remaining.length < 2) {
        const closePayload: WhisperClosePayload = {
          id: whisper.id,
          updatedAt: Date.now()
        };
        await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, closePayload));
      } else {
        const updated: Whisper = {
          ...whisper,
          members: remaining,
          updatedAt: Date.now()
        };
        await publishEnvelope(createEnvelope("WHISPER_UPDATE", identity, updated));
      }

      if (selectedWhisperId === whisper.id) {
        setSelectedWhisperId(undefined);
      }
    },
    [identity, publishEnvelope, selectedWhisperId, setSelectedWhisperId]
  );

  const leaveCurrentWhisper = useCallback(async () => {
    if (!identity) {
      return;
    }

    const selected = selectedWhisperId ? whispers[selectedWhisperId] : undefined;
    const activeWhisper =
      selected && selected.members.includes(identity)
        ? selected
        : Object.values(whispers).find((whisper) => whisper.members.includes(identity));
    if (!activeWhisper) {
      return;
    }

    await leaveWhisper(activeWhisper);
  }, [identity, leaveWhisper, selectedWhisperId, whispers]);

  const closeWhisper = useCallback(
    async (whisper: Whisper) => {
      if (!identity) {
        return;
      }

      const closePayload: WhisperClosePayload = {
        id: whisper.id,
        updatedAt: Date.now()
      };
      await publishEnvelope(createEnvelope("WHISPER_CLOSE", identity, closePayload));
      if (selectedWhisperId === whisper.id) {
        setSelectedWhisperId(undefined);
      }
    },
    [identity, publishEnvelope, selectedWhisperId, setSelectedWhisperId]
  );

  const setSpotlight = useCallback(
    async (targetIdentity: string | null) => {
      if (!identity) {
        return;
      }

      const payload: SpotlightPayload = {
        identity: targetIdentity,
        updatedAt: Date.now()
      };
      await publishEnvelope(createEnvelope("SPOTLIGHT_UPDATE", identity, payload));
    },
    [identity, publishEnvelope]
  );

  useWhisperPtt({
    enabled: Boolean(room && selectedWhisperId),
    onPress: async () => {
      if (!selectedWhisperId || !isSelectedMember) {
        return;
      }

      await startWhisperPtt(selectedWhisperId);
    },
    onRelease: stopWhisperPtt
  });

  useWhisperPtt({
    enabled: Boolean(room && identity),
    keyCode: "KeyG",
    onPress: leaveCurrentWhisper,
    onRelease: () => {}
  });

  return {
    activeWhispers,
    addSelectedParticipantsToWhisper,
    closeWhisper,
    createWhisper,
    followSpotlight,
    isSelectedMember,
    joinWhisper,
    leaveCurrentWhisper,
    leaveWhisper,
    mainVolume,
    selectedParticipantIds,
    selectedParticipants,
    selectedWhisper,
    selectedWhisperId,
    setFollowSpotlight,
    setSelectedWhisperId,
    setSpotlight,
    spotlightIdentity,
    toggleParticipantSelection,
    whisperNotice
  };
}
