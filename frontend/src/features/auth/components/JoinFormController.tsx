import { useState } from "react";
import { AuthLanding } from "@/features/auth/components/AuthLanding";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import { useAvailableCampaigns } from "@/features/campaigns/hooks/useCampaigns";

export function JoinFormController() {
  const auth = useAuthSession();
  const availableCampaigns = useAvailableCampaigns(Boolean(auth.session.user));
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  if (auth.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)]">
        <div className="text-center">
          <p className="display-face text-xl text-[var(--c-text-warm)]">Checking the table</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">Loading backend session state...</p>
        </div>
      </main>
    );
  }

  if (auth.error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Session check failed</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{auth.error}</p>
          <button className="chip mt-6" onClick={() => void auth.refresh()} type="button">
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <AuthLanding
      campaigns={availableCampaigns.campaigns}
      campaignsError={availableCampaigns.error}
      campaignsLoading={availableCampaigns.isLoading}
      isLoggingOut={isLoggingOut}
      onLogout={() => {
        setIsLoggingOut(true);
        void auth.logout().finally(() => setIsLoggingOut(false));
      }}
      onRetryCampaigns={() => void availableCampaigns.reload()}
      user={auth.session.user}
    />
  );
}
