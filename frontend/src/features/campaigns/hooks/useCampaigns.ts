import { useCallback, useEffect, useState } from "react";
import {
  archiveCampaign,
  createCampaign,
  fetchAvailableCampaigns,
  fetchCampaignDirectory,
  fetchManagedCampaigns,
  updateCampaign
} from "@/features/campaigns/lib/campaign-api";
import type { CampaignInput, CampaignPreset } from "@/features/campaigns/types";

export function useAvailableCampaigns(enabled: boolean) {
  const [campaigns, setCampaigns] = useState<CampaignPreset[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      setCampaigns(await fetchAvailableCampaigns());
    } catch (value) {
      setError(value instanceof Error ? value.message : "Failed to load campaigns");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => void reload(), [reload]);

  return { campaigns, error, isLoading, reload };
}

export function useCampaignDirectory(enabled: boolean) {
  const [users, setUsers] = useState<Awaited<ReturnType<typeof fetchCampaignDirectory>>>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setIsLoading(true);
    void fetchCampaignDirectory()
      .then(setUsers)
      .catch((value: unknown) => setError(value instanceof Error ? value.message : "Failed to load players"))
      .finally(() => setIsLoading(false));
  }, [enabled]);

  return { error, isLoading, users };
}

export function useManagedCampaigns(enabled: boolean) {
  const [campaigns, setCampaigns] = useState<CampaignPreset[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return;
    setIsLoading(true);
    setError(null);
    try {
      setCampaigns(await fetchManagedCampaigns());
    } catch (value) {
      setError(value instanceof Error ? value.message : "Failed to load campaigns");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => void reload(), [reload]);

  const create = useCallback(async (input: CampaignInput) => {
    const campaign = await createCampaign(input);
    setCampaigns((current) => [...current, campaign].sort(byName));
    return campaign;
  }, []);

  const save = useCallback(async (id: number, input: CampaignInput) => {
    const campaign = await updateCampaign(id, input);
    setCampaigns((current) => current.map((value) => (value.id === id ? campaign : value)).sort(byName));
    return campaign;
  }, []);

  const archive = useCallback(async (id: number) => {
    await archiveCampaign(id);
    setCampaigns((current) =>
      current.map((value) => (value.id === id ? { ...value, is_archived: true } : value))
    );
  }, []);

  return { archive, campaigns, create, error, isLoading, reload, save };
}

function byName(left: CampaignPreset, right: CampaignPreset) {
  return left.display_name.localeCompare(right.display_name);
}
