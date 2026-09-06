"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { TotpPrompt } from "@/components/totp-prompt";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const REAUTH_REQUIRED = "REAUTH_REQUIRED";

interface Props {
  id: string;
  action: (id: string) => Promise<{ error: string } | { ok: true }>;
  confirmMessage?: string;
  className?: string;
  iconOnly?: boolean;
  label?: string;
  onSuccess?: () => void;
}

/**
 * Reusable "delete" button with built-in TOTP step-up reauth. Calls the
 * provided server action; if it returns `{ error: "REAUTH_REQUIRED" }`,
 * opens a TOTP prompt and retries on success.
 */
export function DeleteWithTotp({
  id,
  action,
  confirmMessage,
  className,
  iconOnly = false,
  label,
  onSuccess,
}: Props) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await action(id);
      if ("error" in res) {
        if (res.error === REAUTH_REQUIRED) {
          retryRef.current = true;
          setNeedsTotp(true);
          return;
        }
        setError(res.error);
        toast({ title: t("toast_failed"), description: res.error, tone: "danger" });
        return;
      }
      toast({ title: t("toast_deleted"), description: label, tone: "success" });
      onSuccess?.();
      router.refresh();
    });
  }

  function handleClick() {
    const msg = confirmMessage ?? t("delete_confirm");
    if (!confirm(msg)) return;
    run();
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={cn(
          iconOnly
            ? "btn-icon hover:bg-danger-soft hover:text-danger"
            : "btn-danger btn-sm w-full",
          className,
        )}
        title={label ?? t("delete_btn")}
        aria-label={label ?? t("delete_btn")}
      >
        {pending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
        {!iconOnly && (label ?? t("delete_btn"))}
      </button>
      {error && !iconOnly && (
        <p className="helper-error">{error}</p>
      )}
      <TotpPrompt
        open={needsTotp}
        onClose={() => {
          setNeedsTotp(false);
          retryRef.current = false;
        }}
        onSuccess={() => {
          setNeedsTotp(false);
          if (retryRef.current) {
            retryRef.current = false;
            run();
          }
        }}
      />
    </>
  );
}
