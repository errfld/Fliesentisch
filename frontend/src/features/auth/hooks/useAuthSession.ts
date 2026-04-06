import { useEffect, useMemo, useState } from "react";
import { fetchAuthSession, logout as logoutRequest } from "@/features/auth/lib/auth-api";
import type { AuthSession } from "@/features/auth/types";

const DEFAULT_SESSION: AuthSession = {
  authenticated: false
};

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession>(DEFAULT_SESSION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextSession = await fetchAuthSession();
      setSession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load session");
      setSession(DEFAULT_SESSION);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const logout = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await logoutRequest();
      setSession(DEFAULT_SESSION);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign out");
    } finally {
      setIsLoading(false);
    }
  };

  const isAuthenticated = useMemo(() => session.authenticated, [session.authenticated]);

  return {
    error,
    isAuthenticated,
    isLoading,
    logout,
    refresh,
    session
  };
}
