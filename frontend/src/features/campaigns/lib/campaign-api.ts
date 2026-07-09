import type {
  CampaignDirectoryResponse,
  CampaignDirectoryUser,
  CampaignInput,
  CampaignPreset,
  CampaignsResponse
} from "@/features/campaigns/types";

type ApiErrorPayload = { error?: { message?: string } };

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }
  const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
  throw new Error(body.error?.message ?? "Campaign request failed");
}

export async function fetchAvailableCampaigns(): Promise<CampaignPreset[]> {
  const response = await fetch("/api/v1/campaigns", { credentials: "include" });
  return (await readJson<CampaignsResponse>(response)).campaigns;
}

export async function fetchManagedCampaigns(): Promise<CampaignPreset[]> {
  const response = await fetch("/api/v1/campaigns/manage", { credentials: "include" });
  return (await readJson<CampaignsResponse>(response)).campaigns;
}

export async function fetchCampaignDirectory(): Promise<CampaignDirectoryUser[]> {
  const response = await fetch("/api/v1/campaigns/manage/users", { credentials: "include" });
  return (await readJson<CampaignDirectoryResponse>(response)).users;
}

export async function createCampaign(input: CampaignInput): Promise<CampaignPreset> {
  const response = await fetch("/api/v1/campaigns/manage", {
    credentials: "include",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<CampaignPreset>(response);
}

export async function updateCampaign(id: number, input: CampaignInput): Promise<CampaignPreset> {
  const response = await fetch(`/api/v1/campaigns/manage/${id}`, {
    credentials: "include",
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<CampaignPreset>(response);
}

export async function archiveCampaign(id: number): Promise<void> {
  const response = await fetch(`/api/v1/campaigns/manage/${id}`, {
    credentials: "include",
    method: "DELETE"
  });
  if (!response.ok) {
    await readJson<never>(response);
  }
}
