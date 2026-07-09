import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";
import { CampaignConsole } from "@/features/campaigns/components/CampaignConsole";

export const Route = createFileRoute("/campaigns")({
  component: CampaignsPage
});

function CampaignsPage() {
  const { error, isLoading, session } = useAuthSession();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)]">
        <p className="text-sm text-[var(--c-text-dim)]">Loading campaign tables...</p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center text-sm text-[var(--c-ember)]">{error}</div>
      </main>
    );
  }
  if (!session.authenticated) {
    return <Navigate search={{}} to="/" />;
  }
  if (session.user?.platform_role !== "ADMIN" && session.user?.game_role !== "GAMEMASTER") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Gamemaster access required</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">Players can join assigned tables but cannot change campaign seats.</p>
        </div>
      </main>
    );
  }
  return <CampaignConsole currentUser={session.user} />;
}
