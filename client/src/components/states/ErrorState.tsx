type Props = {
  title?: string;
  error: unknown;
  onRetry?: () => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function ErrorState({ title = "Failed to load", error, onRetry }: Props) {
  return (
    <div
      className="rounded-lg border border-destructive/40 bg-card p-8 text-center"
      data-testid="error-state"
    >
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground mb-3">{errorMessage(error)}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-muted"
        >
          Retry
        </button>
      )}
    </div>
  );
}
