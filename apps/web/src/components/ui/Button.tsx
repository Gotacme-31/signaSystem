import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "normal" | "compact";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-white hover:bg-brand-hover",
  secondary: "border-default bg-surface text-secondary hover:bg-surface-muted hover:text-primary",
  danger: "border-transparent bg-danger text-white hover:bg-danger/90",
  ghost: "border-transparent bg-transparent text-secondary hover:bg-brand-soft hover:text-brand",
};

const sizeClasses: Record<ButtonSize, string> = {
  normal: "h-11 px-4",
  compact: "h-10 px-3",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "normal",
    loading = false,
    loadingLabel,
    disabled,
    type = "button",
    className = "",
    children,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-control border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
});

export default Button;
