import type { HTMLAttributes, ReactNode } from "react";

export type FormFieldProps = HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  htmlFor?: string;
  helper?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
};

export default function FormField({
  label,
  htmlFor,
  helper,
  error,
  required = false,
  children,
  className = "",
  ...props
}: FormFieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`} {...props}>
      <label htmlFor={htmlFor} className="block text-label text-primary">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-helper text-danger" role="alert">{error}</p>
      ) : helper ? (
        <p className="text-helper text-muted">{helper}</p>
      ) : null}
    </div>
  );
}
