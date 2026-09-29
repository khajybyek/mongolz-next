"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n/client";

interface Props {
  userId: string;
  /** Shown in the confirmation and the toast (e-mail, or a short id). */
  userLabel: string;
  /** Removing the camera's last grant re-opens lists/health/playback to every operator. */
  isLastGrant: boolean;
  /** revokeCameraPermissionAction bound to the camera id. */
  action: (userId: string) => Promise<{ error: string } | { ok: true }>;
}

/**
 * Revokes every grant one user holds on this camera. No step-up (revoking
 * narrows live access), but one confirmation that names the person — and,
 * for the last grant, says that the camera becomes visible to every operator
 * in lists again — plus a toast either way instead of a silent reload.
 */
export function RevokeGrantButton({ userId, userLabel, isLastGrant, action }: Props) {
  const { t } = useT();
  const { toast } = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    const message = [
      `${userLabel} — ${t("perm_revoke_confirm")}`,
      isLastGrant ? t("perm_revoke_last_confirm") : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!confirm(message)) return;
    startTransition(async () => {
      try {
        const res = await action(userId);
        if ("error" in res) {
          toast({ title: t("toast_failed"), description: res.error, tone: "danger" });
          return;
        }
        toast({ title: t("perm_revoked"), description: userLabel, tone: "success" });
        router.refresh();
      } catch {
        toast({ title: t("toast_failed"), description: t("perm_err_revoke"), tone: "danger" });
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-icon hover:bg-danger-soft hover:text-danger"
      title={t("perm_revoke_user")}
      aria-label={`${t("perm_revoke_user")} — ${userLabel}`}
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Trash2 className="w-3.5 h-3.5" aria-hidden />}
    </button>
  );
}
