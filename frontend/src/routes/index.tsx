import { createFileRoute } from "@tanstack/react-router";
import { JoinForm } from "@/components/JoinForm";

export const Route = createFileRoute("/")({
  component: HomePage
});

function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-8">
      <JoinForm />
    </main>
  );
}
