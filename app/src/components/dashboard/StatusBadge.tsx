import { cn } from "@/lib/utils";

export type Status = "UPCOMING" | "RECENT" | "MISSING";

const styles: Record<Status, string> = {
  UPCOMING: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  RECENT: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300",
  MISSING: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
};

const labels: Record<Status, string> = {
  UPCOMING: "Upcoming",
  RECENT: "In Library",
  MISSING: "Missing",
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        styles[status],
        className
      )}
    >
      {labels[status]}
    </span>
  );
}
