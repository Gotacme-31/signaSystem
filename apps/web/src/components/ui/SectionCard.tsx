import type { HTMLAttributes } from "react";

export type SectionCardProps = HTMLAttributes<HTMLElement>;

export default function SectionCard({ className = "", ...props }: SectionCardProps) {
  return (
    <section
      className={`rounded-card border border-default bg-surface p-4 shadow-surface sm:p-6 ${className}`}
      {...props}
    />
  );
}
