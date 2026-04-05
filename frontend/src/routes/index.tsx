import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { AuthLanding } from "@/features/auth/components/AuthLanding";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import { logout } from "@/features/auth/lib/auth-api";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  const navigate = useNavigate({ from: "/" });
  const { error, isLoading, reload, session } = useAuthSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="text-center">
          <p className="display-face text-xl text-[var(--c-text-warm)]">Checking the table</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">Loading backend session state...</p>
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Session check failed</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{error}</p>
          <button className="chip mt-6" onClick={() => void reload()} type="button">
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <AuthLanding
      isLoggingOut={isLoggingOut}
      onLogout={() => {
        setIsLoggingOut(true);
        void logout()
          .then(() => {
            void reload();
            void navigate({ to: "/" });
          })
          .finally(() => setIsLoggingOut(false));
      }}
      user={session.user}
    />
  );
}
