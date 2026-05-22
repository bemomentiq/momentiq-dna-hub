import { ReactNode } from "react";

type Props = {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: Props) {
  return (
    <div
      className="rounded-lg border border-card-border bg-card p-8 text-center"
      data-testid="empty-state"
    >
      <h3 className="font-semibold text-sm mb-1">{title}</h3>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
