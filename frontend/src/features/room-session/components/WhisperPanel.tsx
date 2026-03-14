import type { Whisper } from "@/lib/protocol";
import type { WhisperPanelState } from "@/features/room-session/types";
import { formatIdentityLabel, getWhisperLabel } from "@/features/room-session/lib/session-helpers";

type WhisperPanelProps = WhisperPanelState & {
  onCreateWhisper: () => Promise<void>;
  onSelectWhisper: (whisperId?: string) => void;
  onJoinWhisper: (whisper: Whisper) => Promise<void>;
  onAddSelectedParticipants: (whisper: Whisper) => Promise<void>;
  onLeaveWhisper: (whisper: Whisper) => Promise<void>;
  onCloseWhisper: (whisper: Whisper) => Promise<void>;
};

export function WhisperPanel({
  activeWhispers,
  selectedWhisperId,
  selectedWhisper,
  selectedParticipants,
  whisperNotice,
  isPttActive,
  identity,
  onCreateWhisper,
  onSelectWhisper,
  onJoinWhisper,
  onAddSelectedParticipants,
  onLeaveWhisper,
  onCloseWhisper
}: WhisperPanelProps) {
  return (
    <>
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-baseline justify-between">
          <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">WHISPERS</h3>
          <button aria-label="New Whisper" className="chip" onClick={() => void onCreateWhisper()} type="button">
            + New
          </button>
        </div>

        <p className="mt-4 text-[11px] text-[var(--c-text-dim)]" data-testid="whisper-selected-invitees">
          Invitees:{" "}
          {selectedParticipants.length > 0 ? (
            selectedParticipants.map(formatIdentityLabel).join(", ")
          ) : (
            <span className="text-[var(--c-text-faint)]">none</span>
          )}
        </p>

        <div className="mt-2 text-[11px] text-[var(--c-text-dim)]" data-testid="whisper-ptt-panel">
          {selectedWhisper ? (
            <span>
              Active: <span className="text-[var(--c-text)]">{getWhisperLabel(selectedWhisper)}</span>
            </span>
          ) : (
            <span className="text-[var(--c-text-faint)]">No whisper selected</span>
          )}
          <span className="mx-2 text-[var(--c-text-faint)]">/</span>
          <span className="text-[var(--c-text-faint)]">
            <strong className="text-[var(--c-text-dim)]">V</strong> talk
            <span className="mx-1">&middot;</span>
            <strong className="text-[var(--c-text-dim)]">G</strong> leave
          </span>
          <span className="mx-2 text-[var(--c-text-faint)]">/</span>
          <span
            data-testid="whisper-ptt-status"
            className={isPttActive ? "font-medium text-[var(--c-emerald)]" : "text-[var(--c-text-faint)]"}
          >
            PTT: {isPttActive ? "active" : "idle"}
          </span>
        </div>

        {whisperNotice && (
          <p className="mt-2 text-[11px] text-[var(--c-gold)]" data-testid="whisper-notice">
            {whisperNotice}
          </p>
        )}
      </div>

      <ul className="px-5 pb-4">
        {activeWhispers.length === 0 && (
          <li className="py-3 text-[11px] italic text-[var(--c-text-faint)]">No active whispers.</li>
        )}
        {activeWhispers.map((whisper) => {
          const isMember = whisper.members.includes(identity);
          const isSelected = selectedWhisperId === whisper.id;

          return (
            <li
              key={whisper.id}
              className={`border-l-2 py-2.5 pl-3 transition-colors ${
                isSelected ? "border-[var(--c-gold)]" : "border-[var(--c-rule)]"
              }`}
              data-testid={`whisper-card-${whisper.id}`}
            >
              <p className="text-xs font-medium text-[var(--c-text)]">{getWhisperLabel(whisper)}</p>
              <p className="mt-0.5 text-[10px] text-[var(--c-text-dim)]" data-testid={`whisper-members-${whisper.id}`}>
                {whisper.members.map(formatIdentityLabel).join(", ")}
                <span className="sr-only"> Raw members: {whisper.members.join(", ")}</span>
              </p>
              <div className="mt-1.5 flex items-center gap-3">
                <button
                  className={`act ${isSelected ? "act--gold" : ""}`}
                  onClick={() => onSelectWhisper(isSelected ? undefined : whisper.id)}
                  type="button"
                >
                  {isSelected ? "Active" : "Select"}
                </button>
                {isMember ? (
                  <>
                    {selectedParticipants.length > 0 && (
                      <button className="act" onClick={() => void onAddSelectedParticipants(whisper)} type="button">
                        + Add
                      </button>
                    )}
                    <button className="act" onClick={() => void onLeaveWhisper(whisper)} type="button">
                      Leave
                    </button>
                  </>
                ) : (
                  <button className="act act--emerald" onClick={() => void onJoinWhisper(whisper)} type="button">
                    Join
                  </button>
                )}
                <button className="act act--hot" onClick={() => void onCloseWhisper(whisper)} type="button">
                  Close
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
