"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

export type StepUpActionResult = { error: string } | { ok: true } | void;

interface Props {
  /** Server action. Returns `{ error: "REAUTH_REQUIRED" }` when the second factor is stale. */
  action: (formData: FormData) => Promise<StepUpActionResult>;
  children: ReactNode;
  className?: string;
}

/**
 * Drop-in replacement for `<form action={serverAction}>` on server-rendered
 * pages whose action needs a fresh TOTP step-up. When the action answers
 * REAUTH_REQUIRED the TOTP prompt opens and the SAME submission is retried
 * after a correct code — the operator never loses what they typed and is
 * never left with a silent no-op.
 */
export function StepUpForm({ action, children, className }: Props) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [needsTotp, setNeedsTotp] = useState(false);
  const pendingData = useRef<FormData | null>(null);

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
          return;
        }
        pendingData.current = null;
        toast({ title: t("step_up_saved"), tone: "success" });
        router.refresh();
      } catch (e) {
        toast({ title: e instanceof Error && e.message ? e.message : t("ai_error_generic"), tone: "danger" });
      }
    });
  }

  return (
    <>
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          pendingData.current = null;
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          const data = pendingData.current;
          if (data) run(data);
        }}
      />
      <form
        className={className}
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          run(new FormData(e.currentTarget));
        }}
      >
        {children}
      </form>
    </>
  );
}
