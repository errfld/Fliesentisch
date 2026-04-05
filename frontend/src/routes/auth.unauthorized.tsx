import { createFileRoute } from "@tanstack/react-router";
import { UnauthorizedState } from "@/features/auth/components/UnauthorizedState";

type UnauthorizedSearch = {
  detail?: string;
  reason?: string;
};

export const Route = createFileRoute("/auth/unauthorized")({
  validateSearch: (search: Record<string, unknown>): UnauthorizedSearch => ({
    detail: typeof search.detail === "string" ? search.detail : undefined,
    reason: typeof search.reason === "string" ? search.reason : undefined
  }),
  component: UnauthorizedPage
});

function UnauthorizedPage() {
  const search = Route.useSearch();
  return <UnauthorizedState detail={search.detail} reason={search.reason} />;
}
