import { forwardRef, type InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = "", "aria-invalid": ariaInvalid, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={`h-11 w-full rounded-control border bg-surface px-3 text-body text-primary transition placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted ${invalid ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : "border-default focus-visible:border-brand focus-visible:ring-brand/20"} ${className}`}
      {...props}
    />
  );
});

export default Input;
