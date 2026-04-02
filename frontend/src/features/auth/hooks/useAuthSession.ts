import { useCallback, useEffect, useRef, useState } from "react";

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
  const requestIdRef = useRef(0);
  const activeRequestControllerRef = useRef<AbortController | null>(null);

  const beginRequest = useCallback(() => {
    activeRequestControllerRef.current?.abort();
    const controller = new AbortController();
    activeRequestControllerRef.current = controller;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    return { controller, requestId };
  }, []);

  const isCurrentRequest = useCallback((requestId: number) => requestIdRef.current === requestId, []);

  const refresh = useCallback(async () => {
    const { controller, requestId } = beginRequest();
    setIsLoading(true);
    try {
      const response = await fetch("/api/v1/auth/session", {
        credentials: "include",
        signal: controller.signal
      });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      if (response.ok) {
        const body = (await response.json()) as AuthSession;
        if (!isCurrentRequest(requestId)) {
          return;
        }
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
    } catch (error) {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return;
      }
      setError(AUTH_UNAVAILABLE_MESSAGE);
    } finally {
      if (isCurrentRequest(requestId)) {
        setIsLoading(false);
      }
    }
  }, [beginRequest, isCurrentRequest]);

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

  useEffect(() => {
    return () => {
      activeRequestControllerRef.current?.abort();
    };
  }, []);

  const login = useCallback(async (email: string): Promise<LoginResult> => {
    const { controller, requestId } = beginRequest();
    try {
      const response = await fetch("/api/v1/auth/login", {
        credentials: "include",
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({ email })
      });

      const body = await response.json().catch(() => null);
      if (!isCurrentRequest(requestId)) {
        return { ok: false };
      }
      if (!response.ok) {
        const message = body?.error?.message ?? "Sign-in failed.";
        setError(message);
        return { ok: false, error: message };
      }

      setSession(body as AuthSession);
      setError(null);
      return { ok: true };
    } catch {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return { ok: false };
      }
      const message = "Unable to reach auth service.";
      setError(message);
      return { ok: false, error: message };
    } finally {
      if (isCurrentRequest(requestId)) {
        setIsLoading(false);
      }
    }
  }, [beginRequest, isCurrentRequest]);

  const logout = useCallback(async () => {
    const { controller, requestId } = beginRequest();
    try {
      const response = await fetch("/api/v1/auth/logout", {
        method: "POST",
        credentials: "include",
        signal: controller.signal
      });
      if (!isCurrentRequest(requestId)) {
        return;
      }
      if (!response.ok) {
        setError("Sign-out failed.");
        return;
      }

      setSession(null);
      setError(null);
    } catch {
      if (controller.signal.aborted || !isCurrentRequest(requestId)) {
        return;
      }
      setError("Unable to reach auth service.");
    } finally {
      if (isCurrentRequest(requestId)) {
        setIsLoading(false);
      }
    }
  }, [beginRequest, isCurrentRequest]);

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
