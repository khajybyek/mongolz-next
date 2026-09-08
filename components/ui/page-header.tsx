import { type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  icon?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumbs,
  icon,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 md:mb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          {breadcrumbs.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-text-faint">/</span>}
              {b.href ? (
                <Link href={b.href as never} className="hover:text-text transition-colors">
                  {b.label}
                </Link>
              ) : (
                <span className="text-text-soft">{b.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 lg:gap-6">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {icon && (
            <div className="icon-tile w-11 h-11 mt-0.5" aria-hidden>
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-text text-balance">{title}</h1>
            {subtitle && <p className="text-sm leading-relaxed text-text-muted mt-1.5 max-w-2xl text-pretty">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2 lg:justify-end">{actions}</div>}
      </div>
    </div>
  );
}
