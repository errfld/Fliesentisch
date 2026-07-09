import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCampaignInvite,
  fetchCampaignInvites,
  fetchPublicInvite,
  redeemInvite,
  revokeCampaignInvite
} from "@/features/invites/lib/invite-api";
import type { CreatedInvite, InviteInput, PublicInvite, RedeemedInvite } from "@/features/invites/types";

export function useCampaignInvites(campaignId: number) {
  const [invites, setInvites] = useState<Awaited<ReturnType<typeof fetchCampaignInvites>>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setInvites(await fetchCampaignInvites(campaignId));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Failed to load invite links");
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => void reload(), [reload]);

  const create = useCallback(async (input: InviteInput): Promise<CreatedInvite> => {
    const created = await createCampaignInvite(campaignId, input);
    setInvites((current) => [created.invite, ...current]);
    return created;
  }, [campaignId]);

  const revoke = useCallback(async (inviteId: number) => {
    await revokeCampaignInvite(campaignId, inviteId);
    setInvites((current) =>
      current.map((invite) => invite.id === inviteId ? { ...invite, status: "REVOKED" } : invite)
    );
  }, [campaignId]);

  return { create, error, invites, isLoading, reload, revoke };
}

export function useInviteRedemption(token: string, authenticated: boolean) {
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [redeemed, setRedeemed] = useState<RedeemedInvite | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptedToken = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(null);
    void fetchPublicInvite(token)
      .then((value) => active && setInvite(value))
      .catch((value: unknown) => active && setError(value instanceof Error ? value.message : "Invite link is invalid"))
      .finally(() => active && setIsLoading(false));
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!authenticated) {
      attemptedToken.current = null;
      return;
    }
    if (!invite || redeemed || isRedeeming || attemptedToken.current === token) return;
    attemptedToken.current = token;
    setIsRedeeming(true);
    setError(null);
    void redeemInvite(token)
      .then(setRedeemed)
      .catch((value: unknown) => setError(value instanceof Error ? value.message : "Invite could not be redeemed"))
      .finally(() => setIsRedeeming(false));
  }, [authenticated, invite, isRedeeming, redeemed, token]);

  return { error, invite, isLoading, isRedeeming, redeemed };
}
