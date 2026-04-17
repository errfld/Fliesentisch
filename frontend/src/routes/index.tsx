import { createFileRoute } from "@tanstack/react-router";
import { JoinFormController } from "@/features/auth/components/JoinFormController";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return <JoinFormController />;
}
