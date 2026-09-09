import { forwardRef, type TextareaHTMLAttributes } from "react";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = "", "aria-invalid": ariaInvalid, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      className={`min-h-28 w-full resize-y rounded-control border bg-surface px-3 py-2.5 text-body text-primary transition placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted ${invalid ? "border-danger focus-visible:border-danger focus-visible:ring-danger/20" : "border-default focus-visible:border-brand focus-visible:ring-brand/20"} ${className}`}
      {...props}
    />
  );
});

export default Textarea;
