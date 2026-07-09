import type {
  AnyProtocolEnvelope,
  HandoutPresenterRole
} from "@/lib/protocol";
import {
  MAX_HANDOUT_TITLE_LENGTH,
  MAX_HANDOUT_URL_LENGTH
} from "@/lib/protocol";
import type { GameRole, PlatformRole } from "@/features/room-session/types";

type HandoutAuthorityInput = {
  gameRole?: GameRole;
  platformRole?: PlatformRole;
};

type HandoutEnvelope = Extract<
  AnyProtocolEnvelope,
  { type: "HANDOUT_STATE_REQUEST" | "HANDOUT_STATE_SNAPSHOT" | "HANDOUT_SPOTLIGHT_UPDATE" }
>;

type HandoutEnvelopeSenderInput = HandoutAuthorityInput & {
  envelope: HandoutEnvelope;
  senderIdentity: string;
};

export function canManageHandoutSpotlight({ gameRole, platformRole }: HandoutAuthorityInput): boolean {
  return gameRole === "gamemaster" || platformRole === "admin";
}

export function resolveHandoutPresenterRole({
  gameRole,
  platformRole
}: HandoutAuthorityInput): HandoutPresenterRole | undefined {
  if (platformRole === "admin") {
    return "admin";
  }
  return gameRole === "gamemaster" ? "gamemaster" : undefined;
}

export function resolveParticipantAuthorityRoles(
  attributes?: Readonly<Record<string, string>> | null
): HandoutAuthorityInput {
  const gameRole = attributes?.game_role;
  const platformRole = attributes?.platform_role;
  return {
    gameRole: gameRole === "gamemaster" || gameRole === "player" ? gameRole : undefined,
    platformRole: platformRole === "admin" || platformRole === "user" ? platformRole : undefined
  };
}

export function shouldAcceptHandoutEnvelopeFromSender({
  envelope,
  senderIdentity,
  gameRole,
  platformRole
}: HandoutEnvelopeSenderInput): boolean {
  if (envelope.type === "HANDOUT_STATE_REQUEST") {
    return true;
  }
  if (!canManageHandoutSpotlight({ gameRole, platformRole })) {
    return false;
  }
  if (envelope.type === "HANDOUT_STATE_SNAPSHOT" || envelope.payload.handout === null) {
    return true;
  }

  const presenterRole = resolveHandoutPresenterRole({ gameRole, platformRole });
  return (
    envelope.payload.handout.presenterIdentity === senderIdentity &&
    envelope.payload.handout.presenterRole === presenterRole
  );
}

export function normalizeHandoutImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_HANDOUT_URL_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeHandoutTitle(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_HANDOUT_TITLE_LENGTH) : undefined;
}
