import type { AdminUser, AdminUsersResponse, AuthSession, GameRole, PlatformRole } from "@/features/auth/types";

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export type AdminUserInput = {
  email: string;
  display_name?: string;
  platform_role: PlatformRole;
  game_role: GameRole;
  is_active: boolean;
};

export type AdminUserPatch = Partial<AdminUserInput>;

async function readJson<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  const body = (await response.json().catch(() => ({}))) as ApiErrorPayload;
  const message = body.error?.message ?? "Request failed";
  throw new Error(message);
}

export async function fetchAuthSession(): Promise<AuthSession> {
  const response = await fetch("/api/v1/auth/session", {
    credentials: "include"
  });
  return readJson<AuthSession>(response);
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/v1/auth/logout", {
    credentials: "include",
    method: "POST"
  });
  await readJson<{ ok: boolean }>(response);
}

export function buildGoogleLoginUrl(next: string): string {
  const params = new URLSearchParams({ next });
  return `/api/v1/auth/google/login?${params.toString()}`;
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await fetch("/api/v1/admin/users", {
    credentials: "include"
  });
  const body = await readJson<AdminUsersResponse>(response);
  return body.users;
}

export async function createAdminUser(input: AdminUserInput): Promise<AdminUser> {
  const response = await fetch("/api/v1/admin/users", {
    credentials: "include",
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return readJson<AdminUser>(response);
}

export async function updateAdminUser(userId: number, patch: AdminUserPatch): Promise<AdminUser> {
  const response = await fetch(`/api/v1/admin/users/${userId}`, {
    credentials: "include",
    method: "PATCH",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(patch)
  });

  return readJson<AdminUser>(response);
}

export async function deleteAdminUser(userId: number): Promise<void> {
  const response = await fetch(`/api/v1/admin/users/${userId}`, {
    credentials: "include",
    method: "DELETE"
  });

  if (!response.ok) {
    await readJson<never>(response);
  }
}
