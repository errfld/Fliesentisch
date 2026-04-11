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

  const createUser = useCallback(async (input: AdminUserInput) => {
    try {
      const user = await createAdminUser(input);
      setUsers((current) => [...current, user].sort((a, b) => a.email.localeCompare(b.email)));
      setError(null);
      return user;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
      throw err;
    }
  }, []);

  const saveUser = useCallback(async (userId: number, patch: AdminUserPatch) => {
    try {
      const updated = await updateAdminUser(userId, patch);
      setUsers((current) => current.map((user) => (user.id === userId ? updated : user)));
      setError(null);
      return updated;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user");
      throw err;
    }
  }, []);

  const removeUser = useCallback(async (userId: number) => {
    try {
      await deleteAdminUser(userId);
      setUsers((current) => current.filter((user) => user.id !== userId));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete user");
      throw err;
    }
  }, []);

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
