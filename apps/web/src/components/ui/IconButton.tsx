import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  "aria-label": string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border-transparent bg-brand text-white hover:bg-brand-hover",
  secondary: "border-default bg-surface text-secondary hover:bg-surface-muted hover:text-primary",
  danger: "border-transparent bg-danger text-white hover:bg-danger/90",
  ghost: "border-transparent bg-transparent text-secondary hover:bg-brand-soft hover:text-brand",
};

const sizeClasses: Record<ButtonSize, string> = {
  normal: "h-11 w-11",
  compact: "h-10 w-10",
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    variant = "ghost",
    size = "normal",
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
      disabled={disabled}
      className={`inline-flex shrink-0 items-center justify-center rounded-control border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:h-5 [&_svg]:w-5 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export default IconButton;
