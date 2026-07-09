import type {
  CampaignInvite,
  CampaignInvitesResponse,
  CreatedInvite,
  InviteInput,
  PublicInvite,
  RedeemedInvite
} from "@/features/invites/types";

type ApiErrorPayload = { error?: { message?: string } };

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
  throw new Error(body.error?.message ?? "Invite request failed");
}

export async function fetchCampaignInvites(campaignId: number): Promise<CampaignInvite[]> {
  const response = await fetch(`/api/v1/campaigns/manage/${campaignId}/invites`, {
    credentials: "include"
  });
  return (await readJson<CampaignInvitesResponse>(response)).invites;
}

export async function createCampaignInvite(campaignId: number, input: InviteInput): Promise<CreatedInvite> {
  const response = await fetch(`/api/v1/campaigns/manage/${campaignId}/invites`, {
    credentials: "include",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<CreatedInvite>(response);
}

export async function revokeCampaignInvite(campaignId: number, inviteId: number): Promise<void> {
  const response = await fetch(`/api/v1/campaigns/manage/${campaignId}/invites/${inviteId}`, {
    credentials: "include",
    method: "DELETE"
  });
  if (!response.ok) await readJson<never>(response);
}

export async function fetchPublicInvite(token: string): Promise<PublicInvite> {
  const response = await fetch(`/api/v1/invites/${encodeURIComponent(token)}`);
  return readJson<PublicInvite>(response);
}

export async function redeemInvite(token: string): Promise<RedeemedInvite> {
  const response = await fetch(`/api/v1/invites/${encodeURIComponent(token)}/redeem`, {
    credentials: "include",
    method: "POST"
  });
  return readJson<RedeemedInvite>(response);
}
