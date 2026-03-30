import { useCallback, useEffect, useState } from "react";

type AuthSession = {
  email: string;
  game_role: string;
  platform_role: string;
  expires_at: string;
};

type LoginResult = {
  ok: boolean;
  error?: string;
};

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/auth/session");
      if (!response.ok) {
        setSession(null);
        setError(null);
        return;
      }

      const body = (await response.json()) as AuthSession;
      setSession(body);
      setError(null);
    } catch {
      setSession(null);
      setError("Unable to reach auth service.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string): Promise<LoginResult> => {
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ email })
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body?.error?.message ?? "Sign-in failed.";
        setError(message);
        return { ok: false, error: message };
      }

      setSession(body as AuthSession);
      setError(null);
      return { ok: true };
    } catch {
      const message = "Unable to reach auth service.";
      setError(message);
      return { ok: false, error: message };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      setSession(null);
      setError(null);
    }
  }, []);

  return {
    error,
    isAuthenticated: Boolean(session),
    isLoading,
    login,
    logout,
    refresh,
    session
  };
}
