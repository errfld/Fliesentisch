import { useEffect, useState } from "react";
import { fetchAuthSession } from "@/features/auth/lib/auth-api";
import type { AuthSession } from "@/features/auth/types";

const DEFAULT_SESSION: AuthSession = {
  authenticated: false
};

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession>(DEFAULT_SESSION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
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
    void reload();
  }, []);

  return {
    error,
    isLoading,
    reload,
    session
  };
}
