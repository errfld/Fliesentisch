import { createFileRoute, Navigate } from "@tanstack/react-router";
import { AdminConsole } from "@/features/auth/components/AdminConsole";
import { useAuthSession } from "@/features/auth/hooks/useAuthSession";

export const Route = createFileRoute("/admin")({
  component: AdminPage
});

function AdminPage() {
  const { error, isLoading, session } = useAuthSession();

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)]">
        <p className="text-sm text-[var(--c-text-dim)]">Loading admin console...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Admin console unavailable</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">{error}</p>
        </div>
      </main>
    );
  }

  if (!session.authenticated) {
    return <Navigate search={{}} to="/" />;
  }

  if (session.user?.platform_role !== "ADMIN") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--c-void)] px-8">
        <div className="panel max-w-xl text-center">
          <p className="display-face text-xl text-[var(--c-ember)]">Admin access required</p>
          <p className="mt-3 text-sm text-[var(--c-text-dim)]">
            This session can join rooms, but it cannot manage the allowlist.
          </p>
        </div>
      </main>
    );
  }

  return <AdminConsole currentUser={session.user} />;
}
