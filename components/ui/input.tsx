import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helper, error, leading, trailing, className, id, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? rest.name ?? generatedId;
  const description = [rest["aria-describedby"], error ? `${inputId}-error` : helper ? `${inputId}-helper` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="label">
          {label}
        </label>
      )}
      <div className="relative">
        {leading && (
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
            {leading}
          </span>
        )}
        <input
          ref={ref}
          {...rest}
          id={inputId}
          aria-invalid={error ? "true" : rest["aria-invalid"]}
          aria-describedby={description}
          className={cn(
            "input",
            error && "input-error",
            leading && "pl-10",
            trailing && "pr-10",
            className
          )}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-muted">
            {trailing}
          </span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="helper-error">
          {error}
        </p>
      ) : helper ? (
        <p id={`${inputId}-helper`} className="helper">
          {helper}
        </p>
      ) : null}
    </div>
  );
});
