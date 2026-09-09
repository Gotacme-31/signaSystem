import { forwardRef, type SelectHTMLAttributes } from "react";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = "", "aria-invalid": ariaInvalid, ...props },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={`h-11 w-full rounded-control border bg-surface px-3 text-body text-primary transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted ${invalid ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : "border-default focus-visible:border-brand focus-visible:ring-brand/20"} ${className}`}
      {...props}
    />
  );
});

export default Select;
