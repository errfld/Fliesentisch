import type { ParticipantRosterItem } from "@/features/room-session/types";

type ParticipantRosterProps = {
  participantRoster: ParticipantRosterItem[];
  title?: string;
};

export function ParticipantRoster({ participantRoster, title = "AT TABLE" }: ParticipantRosterProps) {
  return (
    <div className="px-5 pt-4 pb-4">
      <h3 className="display-face text-xs tracking-[0.08em] text-[var(--c-text-warm)]">{title}</h3>
      <div className="mt-3">
        {participantRoster.map((participant, index) => (
          <div
            key={participant.identity}
            className={`flex items-center justify-between py-2 ${
              index < participantRoster.length - 1 ? "border-b border-[var(--c-rule)]" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="truncate text-xs text-[var(--c-text)]">
                {participant.label}
                {participant.isLocal ? <span className="ml-1 text-[var(--c-text-faint)]">(you)</span> : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-[10px]">{getStatusIndicator(participant)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getStatusIndicator(participant: ParticipantRosterItem) {
  if (participant.isSpotlight) {
    return <span className="text-[var(--c-gold)]">Spotlight</span>;
  }

  if (participant.whisperLabel) {
    return <span className="text-teal-400">Whisper</span>;
  }

  if (participant.isSpeaking) {
    return <span className="text-[var(--c-emerald)]">Speaking</span>;
  }

  if (participant.hasVideo) {
    return <span className="text-[var(--c-text-faint)]">Video</span>;
  }

  return <span className="text-[var(--c-text-faint)]">Audio</span>;
}
