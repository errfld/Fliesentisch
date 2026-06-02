import { resolveParticipantRoomId } from "@/features/room-session/lib/session-selectors";
import type { SplitRoom, SplitState } from "@/lib/protocol";

export type SplitParticipantOption = {
  identity: string;
  label: string;
  isLocal: boolean;
};

type SplitParticipantAssignmentRowProps = {
  participant: SplitParticipantOption;
  rooms: SplitRoom[];
  splitState: SplitState;
  disabled: boolean;
  isPinnedToGmRole: boolean;
  onAssignParticipantToRoom: (participantIdentity: string, roomId: string) => Promise<boolean>;
};

export function SplitParticipantAssignmentRow({
  participant,
  rooms,
  splitState,
  disabled,
  isPinnedToGmRole,
  onAssignParticipantToRoom
}: SplitParticipantAssignmentRowProps) {
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
