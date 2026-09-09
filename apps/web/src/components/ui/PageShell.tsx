import type { HTMLAttributes } from "react";

export type PageShellWidth = "default" | "wide" | "full";

export type PageShellProps = HTMLAttributes<HTMLDivElement> & {
  width?: PageShellWidth;
};

const widthClasses: Record<PageShellWidth, string> = {
  default: "max-w-7xl",
  wide: "max-w-[1800px]",
  full: "max-w-none",
};

export default function PageShell({ width = "default", className = "", ...props }: PageShellProps) {
  return (
    <div
      className={`mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 ${widthClasses[width]} ${className}`}
      {...props}
    />
  );
}
