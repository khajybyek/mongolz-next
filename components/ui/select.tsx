import { forwardRef, useId, type SelectHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, helper, error, className, id, children, ...rest },
  ref
) {
  const generatedId = useId();
  const selectId = id ?? rest.name ?? generatedId;
  const description = [rest["aria-describedby"], error ? `${selectId}-error` : helper ? `${selectId}-helper` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={selectId} className="label">
          {label}
        </label>
      )}
      <select
        ref={ref}
        {...rest}
        id={selectId}
        aria-invalid={error ? "true" : rest["aria-invalid"]}
        aria-describedby={description}
        className={cn("select", error && "input-error", className)}
      >
        {children}
      </select>
      {error ? (
        <p id={`${selectId}-error`} className="helper-error">{error}</p>
      ) : helper ? (
        <p id={`${selectId}-helper`} className="helper">{helper}</p>
      ) : null}
    </div>
  );
});
