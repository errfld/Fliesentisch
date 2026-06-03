type RoomSessionStateProps = {
  title?: string;
  message: string;
  tone?: "default" | "error";
};

export function RoomSessionState({ title, message, tone = "default" }: RoomSessionStateProps) {
  const titleClass = tone === "error" ? "text-[var(--c-ember)]" : "text-[var(--c-text-warm)]";
  const isError = tone === "error";

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--c-void)]">
      <div className={title ? "max-w-md text-center" : "text-center"}>
        {title ? <p className={`display-face text-xl ${titleClass}`}>{title}</p> : null}
        <p
          aria-atomic={isError ? "true" : undefined}
          aria-live={isError ? "assertive" : undefined}
          className={title ? "mt-3 text-sm text-[var(--c-text-dim)]" : "text-sm text-[var(--c-text-dim)]"}
          role={isError ? "alert" : undefined}
        >
          {message}
        </p>
      </div>
    </div>
  );
}
