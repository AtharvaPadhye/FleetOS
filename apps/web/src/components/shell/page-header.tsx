import type { ReactNode } from "react";

export function PageHeader({ title, summary, actions }: { title: string; summary: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <h1
          id="main-heading"
          tabIndex={-1}
          className="font-display text-display-l font-semibold [font-stretch:112.5%] focus:outline-none"
        >
          {title}
        </h1>
        <p className="max-w-2xl text-fg-muted">{summary}</p>
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
