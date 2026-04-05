import { useCallback, useEffect, useState } from "react";
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  updateAdminUser,
  type AdminUserInput,
  type AdminUserPatch
} from "@/features/auth/lib/auth-api";
import type { AdminUser } from "@/features/auth/types";

export function useAdminUsers(enabled: boolean) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      setUsers(await fetchAdminUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createUser = async (input: AdminUserInput) => {
    const user = await createAdminUser(input);
    setUsers((current) => [...current, user].sort((a, b) => a.email.localeCompare(b.email)));
  };

  const saveUser = async (userId: number, patch: AdminUserPatch) => {
    const updated = await updateAdminUser(userId, patch);
    setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
  };

  const removeUser = async (userId: number) => {
    await deleteAdminUser(userId);
    setUsers((current) => current.filter((user) => user.id !== userId));
  };

  return {
    createUser,
    error,
    isLoading,
    reload,
    removeUser,
    saveUser,
    users
  };
}
