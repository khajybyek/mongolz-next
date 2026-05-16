import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/supabase/auth";
import { EraseForm } from "./erase-form";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ErasePage() {
  // Admin only — non-admins don't currently see this page since /settings is
  // admin-only. Auditor cannot reach here either.
  const { user, profile } = await requireAdmin();
  const svc = createServiceClient();
  const { data } = await svc
    .from("profiles")
    .select("totp_enabled")
    .eq("id", user.id)
    .single();

  return (
    <>
      <Link
        href="/settings"
        className="text-sm text-neutral-400 hover:text-neutral-100 inline-flex items-center gap-1.5 mb-3"
      >
        <ArrowLeft className="w-4 h-4" />
        Тохиргоо
      </Link>
      <PageHeader
        title="Бүртгэлээ устгах"
        subtitle="Right to erasure — GDPR Art.17 / PIPA §36"
      />
      <div className="max-w-md mt-4">
        <EraseForm
          email={user.email}
          role={profile.role}
          totpEnabled={Boolean(data?.totp_enabled)}
        />
      </div>
    </>
  );
}
