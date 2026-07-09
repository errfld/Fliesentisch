import { createFileRoute } from "@tanstack/react-router";
import { InviteLanding } from "@/features/invites/components/InviteLanding";

type InviteSearch = { error?: string };

export const Route = createFileRoute("/invite/$token")({
  validateSearch: (search: Record<string, unknown>): InviteSearch => ({
    error: typeof search.error === "string" ? search.error : undefined
  }),
  component: InvitePage
});

function InvitePage() {
  const { token } = Route.useParams();
  const { error } = Route.useSearch();
  return <InviteLanding callbackError={error} token={token} />;
}
