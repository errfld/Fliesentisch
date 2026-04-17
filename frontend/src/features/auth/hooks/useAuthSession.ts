import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAuthSession, logout as logoutRequest } from "@/features/auth/lib/auth-api";
import type { AuthSession } from "@/features/auth/types";

const DEFAULT_SESSION: AuthSession = {
  authenticated: false
};

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession>(DEFAULT_SESSION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const nextSession = await fetchAuthSession();
      if (requestIdRef.current === requestId) {
        setSession(nextSession);
      }
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Failed to load session");
        setSession(DEFAULT_SESSION);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      await logoutRequest();
      if (requestIdRef.current === requestId) {
        setSession(DEFAULT_SESSION);
      }
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : "Failed to sign out");
        setSession(DEFAULT_SESSION);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  const isAuthenticated = session.authenticated;

  return {
    error,
    isAuthenticated,
    isLoading,
    logout,
    refresh,
    session
  };
}
