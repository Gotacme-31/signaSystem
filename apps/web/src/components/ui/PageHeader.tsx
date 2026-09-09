import type { HTMLAttributes, ReactNode } from "react";

export type PageHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  metadata?: ReactNode;
};

export default function PageHeader({
  title,
  description,
  icon,
  actions,
  metadata,
  className = "",
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={`flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between ${className}`}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand [&_svg]:h-5 [&_svg]:w-5">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-page-title text-primary">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-body text-secondary">{description}</p>}
          {metadata && <div className="mt-3 flex flex-wrap items-center gap-2 text-helper text-muted">{metadata}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
