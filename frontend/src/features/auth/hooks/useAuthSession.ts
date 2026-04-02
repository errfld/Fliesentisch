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

const AUTH_UNAVAILABLE_MESSAGE = "Auth service unavailable.";

export function useAuthSession() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionExpiresAt = session ? Date.parse(session.expires_at) : Number.NaN;
  const isAuthenticated =
    session !== null && Number.isFinite(sessionExpiresAt) && sessionExpiresAt > Date.now();

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/auth/session");
      if (response.ok) {
        const body = (await response.json()) as AuthSession;
        setSession(body);
        setError(null);
        return;
      }

      if (response.status === 401 || response.status === 404) {
        setSession(null);
        setError(null);
        return;
      }

      setError(AUTH_UNAVAILABLE_MESSAGE);
    } catch {
      setError(AUTH_UNAVAILABLE_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!session) {
      return;
    }

    if (!Number.isFinite(sessionExpiresAt) || sessionExpiresAt <= Date.now()) {
      setSession(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setSession(null);
      setError(null);
      setIsLoading(false);
    }, sessionExpiresAt - Date.now());

    return () => window.clearTimeout(timer);
  }, [session, sessionExpiresAt]);

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
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) {
        setError("Sign-out failed.");
        return;
      }

      setSession(null);
      setError(null);
    } catch {
      setError("Unable to reach auth service.");
    }
  }, []);

  return {
    error,
    isAuthenticated,
    isLoading,
    login,
    logout,
    refresh,
    session
  };
}
