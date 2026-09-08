"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

export function PasswordInput({ showLabel, hideLabel }: { showLabel: string; hideLabel: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        autoComplete="current-password"
        required
        className="input min-h-12 pr-14 text-base"
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        aria-controls="password"
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-text-muted transition-colors hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

export function LoginSubmitButton({ label, pendingLabel, secondary = false }: {
  label: string;
  pendingLabel: string;
  secondary?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${secondary ? "btn-ghost" : "btn-primary"} min-h-12 w-full justify-center gap-2.5 text-sm`}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      <span aria-live="polite">{pending ? pendingLabel : label}</span>
      {!pending && !secondary && <ArrowRight className="h-4 w-4" aria-hidden />}
    </button>
  );
}
