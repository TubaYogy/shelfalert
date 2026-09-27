import { BookCover } from "./BookCover";
import { StatusBadge, type Status } from "./StatusBadge";
import { formatDate } from "@/lib/utils";

export interface ReleaseCardData {
  id: number;
  title: string;
  coverUrl?: string | null;
  publishDate?: string | null;
  seriesName?: string | null;
  seriesNumber?: number | null;
  status: Status;
  format?: string | null;
  author: { name: string };
}

export function ReleaseCard({ release }: { release: ReleaseCardData }) {
  return (
    <div className="group flex gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <BookCover
        src={release.coverUrl}
        alt={release.title}
        className="h-24 w-16 flex-shrink-0"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {release.title}
          </h3>
          <StatusBadge status={release.status} className="flex-shrink-0" />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
          {release.author.name}
        </p>
        {release.seriesName && (
          <p className="mt-1 truncate text-xs text-brand-600 dark:text-brand-400">
            {release.seriesName}
            {release.seriesNumber != null ? ` #${release.seriesNumber}` : ""}
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{formatDate(release.publishDate)}</span>
          {release.format && <span className="capitalize">· {release.format}</span>}
        </div>
      </div>
    </div>
  );
}
