import { useState } from "react";
import { resolveParticipantRoomId } from "@/features/room-session/lib/session-selectors";
import { canAddSideRoom } from "@/features/room-session/lib/split-room-rules";
import type { SplitRoom, SplitState } from "@/lib/protocol";

type SplitParticipantOption = {
  identity: string;
  label: string;
  isLocal: boolean;
};

type SplitControlPanelProps = {
  splitState: SplitState;
  participants: SplitParticipantOption[];
  isPublishingCommand: boolean;
  commandError: string | null;
  onStartSplit: () => Promise<boolean>;
  onAddRoom: () => Promise<boolean>;
  onRemoveRoom: (roomId: string) => Promise<boolean>;
  onRenameRoom: (roomId: string, roomName: string) => Promise<boolean>;
  onAssignParticipantToRoom: (participantIdentity: string, roomId: string) => Promise<boolean>;
  onSetGmFocusRoom: (roomId: string | null) => Promise<boolean>;
  onSetGmBroadcastActive: (active: boolean) => Promise<boolean>;
  onEndSplit: () => Promise<boolean>;
};

export function SplitControlPanel({
  splitState,
  participants,
  isPublishingCommand,
  commandError,
  onStartSplit,
  onAddRoom,
  onRemoveRoom,
  onRenameRoom,
  onAssignParticipantToRoom,
  onSetGmFocusRoom,
  onSetGmBroadcastActive,
  onEndSplit
}: SplitControlPanelProps) {
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [draftRoomName, setDraftRoomName] = useState("");

  return (
    <section className="px-5 pt-4 pb-4">
      <div className="rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_82%,black)] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="display-face text-[11px] tracking-[0.08em] text-[var(--c-text-warm)]">GM SPLIT CONTROL</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--c-text-dim)]">
              {splitState.isActive
                ? "Route players between side rooms and decide whether the GM is focused or broadcasting."
                : "Start split mode to open the first side room. Everyone stays at the main table until moved."}
            </p>
          </div>
        </div>

        {commandError ? <p className="mt-3 text-[11px] leading-5 text-[var(--c-ember)]">{commandError}</p> : null}

        {!splitState.isActive ? (
          <div className="mt-4">
            <button
              className="chip w-full justify-center py-2 text-xs"
              disabled={isPublishingCommand}
              onClick={() => void onStartSplit()}
              type="button"
            >
              {isPublishingCommand ? "Starting split…" : "Start split mode"}
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                className="act"
                disabled={isPublishingCommand || !canAddSideRoom(splitState.rooms)}
                onClick={() => void onAddRoom()}
                type="button"
              >
                Add room
              </button>
              <button
                className={`act ${splitState.gmBroadcastActive ? "act--gold" : ""}`}
                disabled={isPublishingCommand}
                onClick={() => void onSetGmBroadcastActive(!splitState.gmBroadcastActive)}
                type="button"
              >
                {splitState.gmBroadcastActive ? "Broadcasting" : "Broadcast off"}
              </button>
              <button
                className="act act--hot"
                disabled={isPublishingCommand}
                onClick={() => void onEndSplit()}
                type="button"
              >
                Merge table
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {splitState.rooms.map((room) => {
                const roomParticipantCount = participants.filter(
                  (participant) =>
                    participant.identity !== splitState.gmIdentity &&
                    resolveParticipantRoomId(splitState, participant.identity) === room.id
                ).length;
                const isFocused = splitState.gmFocusRoomId === room.id;

                return (
                  <div
                    key={room.id}
                    className="rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_72%,black)] px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {editingRoomId === room.id ? (
                          <input
                            autoFocus
                            aria-label={`Rename room ${room.name}`}
                            className="field h-8 px-2 text-xs"
                            onChange={(event) => setDraftRoomName(event.target.value)}
                            value={draftRoomName}
                          />
                        ) : (
                          <p className="text-xs text-[var(--c-text)]">{room.name}</p>
                        )}
                        <p className="mt-1 text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-faint)]">
                          {room.kind === "main" ? "main room" : "side room"} · {roomParticipantCount} assigned
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {room.kind === "side" ? (
                          editingRoomId === room.id ? (
                            <>
                              <button
                                className="act act--gold"
                                disabled={isPublishingCommand}
                                onClick={() => {
                                  void onRenameRoom(room.id, draftRoomName).then((didRename) => {
                                    if (didRename) {
                                      setEditingRoomId(null);
                                      setDraftRoomName("");
                                    }
                                  });
                                }}
                                type="button"
                              >
                                Save
                              </button>
                              <button
                                className="act"
                                disabled={isPublishingCommand}
                                onClick={() => {
                                  setEditingRoomId(null);
                                  setDraftRoomName("");
                                }}
                                type="button"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="act"
                              disabled={isPublishingCommand}
                              onClick={() => {
                                setEditingRoomId(room.id);
                                setDraftRoomName(room.name);
                              }}
                              type="button"
                            >
                              Rename
                            </button>
                          )
                        ) : null}
                        <button
                          className={`act ${isFocused ? "act--gold" : ""}`}
                          disabled={isPublishingCommand}
                          onClick={() => void onSetGmFocusRoom(isFocused ? null : room.id)}
                          type="button"
                        >
                          {isFocused ? "Focused" : "Focus"}
                        </button>
                        {room.kind === "side" ? (
                          <button
                            className="act act--hot"
                            disabled={isPublishingCommand}
                            onClick={() => void onRemoveRoom(room.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 space-y-3">
              {participants.map((participant) => (
                <ParticipantAssignmentRow
                  key={participant.identity}
                  participant={participant}
                  rooms={splitState.rooms}
                  splitState={splitState}
                  disabled={isPublishingCommand}
                  isPinnedToGmRole={participant.identity === splitState.gmIdentity}
                  onAssignParticipantToRoom={onAssignParticipantToRoom}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

type ParticipantAssignmentRowProps = {
  participant: SplitParticipantOption;
  rooms: SplitRoom[];
  splitState: SplitState;
  disabled: boolean;
  isPinnedToGmRole: boolean;
  onAssignParticipantToRoom: (participantIdentity: string, roomId: string) => Promise<boolean>;
};

function ParticipantAssignmentRow({
  participant,
  rooms,
  splitState,
  disabled,
  isPinnedToGmRole,
  onAssignParticipantToRoom
}: ParticipantAssignmentRowProps) {
  const assignedRoomId = resolveParticipantRoomId(splitState, participant.identity);
  const assignedRoomName = rooms.find((room) => room.id === assignedRoomId)?.name ?? "Main Table";

  return (
    <div className="rounded-md border border-[var(--c-rule)] bg-[color-mix(in_srgb,var(--c-ink)_68%,black)] px-3 py-3">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="truncate text-[var(--c-text)]">
          {participant.label}
          {participant.isLocal ? <span className="ml-1 text-[var(--c-text-faint)]">(you)</span> : null}
          {participant.identity === splitState.gmIdentity ? <span className="ml-1 text-[var(--c-gold)]">GM</span> : null}
        </span>
        {participant.identity !== splitState.gmIdentity ? (
          <span className="shrink-0 text-[var(--c-text-faint)]">{assignedRoomName}</span>
        ) : null}
      </div>

      {isPinnedToGmRole ? (
        <p className="mt-3 text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-faint)]">
          GM is globally visible across all rooms
        </p>
      ) : (
        <>
          <p className="mt-3 text-[10px] uppercase tracking-[0.06em] text-[var(--c-text-faint)]">
            Choose a room
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {rooms.map((room) => {
              const isAssigned = room.id === assignedRoomId;

              return (
                <button
                  key={room.id}
                  aria-pressed={isAssigned}
                  className={
                    isAssigned
                      ? "rounded-sm border border-[var(--c-gold-dim)] bg-[color-mix(in_srgb,var(--c-gold)_16%,transparent)] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--c-gold)] transition-colors"
                      : "rounded-sm border border-[var(--c-rule)] px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--c-text-dim)] transition-colors hover:border-[var(--c-text-faint)] hover:text-[var(--c-text)]"
                  }
                  disabled={disabled}
                  onClick={() => void onAssignParticipantToRoom(participant.identity, room.id)}
                  type="button"
                >
                  {room.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
