"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

export type StepUpActionResult = { error: string } | { ok: true } | void;

interface Props {
  /** Server action. Returns `{ error: "REAUTH_REQUIRED" }` when the second factor is stale. */
  action: (formData: FormData) => Promise<StepUpActionResult>;
  children: ReactNode;
  className?: string;
  /** Why this form needs the second factor; shown in the TOTP prompt. */
  stepUpDescription?: string;
  /**
   * Clear the form after a successful save (React resets a `<form action>`
   * on its own; this component handles submit itself, so it opts in). For
   * "add" forms, so the saved values are not left behind to be added twice.
   */
  resetOnSuccess?: boolean;
  /**
   * The fields show SAVED state (a current setting, not a draft): when the
   * change is not saved (step-up cancelled, action refused or failed), put
   * every field back to its server-rendered value so the form never shows a
   * setting that is not in effect.
   */
  revertUnsaved?: boolean;
}

/**
 * Drop-in replacement for `<form action={serverAction}>` on server-rendered
 * pages whose action needs a fresh TOTP step-up. When the action answers
 * REAUTH_REQUIRED the TOTP prompt opens and the SAME submission is retried
 * after a correct code — the operator never loses what they typed and is
 * never left with a silent no-op.
 *
 * While the action runs every control is disabled (a real `disabled`
 * fieldset), so a second click cannot land and the buttons dim. The fieldset
 * carries `className`, so callers' layout classes (`space-y-*`, `card`)
 * still apply to their own children. The form is a one-cell grid, not
 * `display: contents`: it is the box the PARENT lays out, so a parent's
 * `space-y-*` margin lands on it (a contents box drops that margin and the
 * cards touch), and in a grid or flex row the fieldset still stretches to
 * the row's height.
 */
export function StepUpForm({ action, children, className, stepUpDescription, resetOnSuccess, revertUnsaved }: Props) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingData = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function unsaved() {
    if (revertUnsaved) formRef.current?.reset();
  }

  function run(data: FormData) {
    startTransition(async () => {
      try {
        const result = await action(data);
        if (result && "error" in result) {
          if (result.error === "REAUTH_REQUIRED") {
            pendingData.current = data;
            setNeedsTotp(true);
            return;
          }
          toast({ title: result.error, tone: "danger" });
          unsaved();
          return;
        }
        pendingData.current = null;
        toast({ title: t("step_up_saved"), tone: "success" });
        if (resetOnSuccess) formRef.current?.reset();
        router.refresh();
      } catch (e) {
        toast({ title: e instanceof Error && e.message ? e.message : t("ai_error_generic"), tone: "danger" });
        unsaved();
      }
    });
  }

  return (
    <>
      <TotpPrompt
        open={needsTotp}
        description={stepUpDescription}
        onClose={() => {
          setNeedsTotp(false);
          pendingData.current = null;
          unsaved();
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          const data = pendingData.current;
          if (data) run(data);
        }}
      />
      <form
        ref={formRef}
        className="grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          run(new FormData(e.currentTarget));
        }}
      >
        <fieldset disabled={pending} aria-busy={pending} className={cn("min-w-0", className)}>
          {children}
        </fieldset>
      </form>
    </>
  );
}
