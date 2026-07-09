export type InviteRole = "PLAYER";
export type InviteStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED" | "ARCHIVED";

export type CampaignInvite = {
  id: number;
  campaign_id: number;
  campaign_display_name: string;
  room_slug: string;
  token_hint: string;
  role: InviteRole;
  expires_at?: number;
  max_uses?: number;
  use_count: number;
  status: InviteStatus;
  revoked_at?: string;
  created_at: string;
};

export type PublicInvite = Pick<
  CampaignInvite,
  "campaign_id" | "campaign_display_name" | "room_slug" | "role" | "expires_at" | "status"
>;

export type InviteInput = {
  role: InviteRole;
  expires_at?: number;
  max_uses?: number;
};

export type CreatedInvite = {
  invite: CampaignInvite;
  token: string;
  path: string;
};

export type RedeemedInvite = {
  campaign_id: number;
  campaign_display_name: string;
  room_slug: string;
};

export type CampaignInvitesResponse = { invites: CampaignInvite[] };
