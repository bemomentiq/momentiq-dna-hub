import { Fragment } from "react";
import { Link } from "wouter";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export type BreadcrumbItemSpec = {
  label: string;
  href?: string;
};

// Thin wrapper over the shadcn breadcrumb primitive: pass an items array,
// the last item is treated as the current page (non-link).
export function Breadcrumbs({ items }: { items: BreadcrumbItemSpec[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Breadcrumb data-testid="breadcrumbs">
      <BreadcrumbList>
        {items.map((it, idx) => {
          const last = idx === items.length - 1;
          return (
            <Fragment key={`${it.label}-${idx}`}>
              <BreadcrumbItem>
                {last || !it.href ? (
                  <BreadcrumbPage>{it.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={it.href}>{it.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
