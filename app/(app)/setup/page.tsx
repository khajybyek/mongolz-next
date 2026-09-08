import { CheckCircle, Circle, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/supabase/auth";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

interface Step {
  title: string;
  desc: string;
  done: boolean;
  href: Route;
}

export default async function SetupPage() {
  const { profile } = await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();

  const [
    { count: cameraCount },
    { count: suspectCount },
    { count: recordingCount },
    { count: faceCount },
  ] = await Promise.all([
    supabase.from("cameras").select("*", { count: "exact", head: true }),
    supabase.from("suspects").select("*", { count: "exact", head: true }),
    supabase.from("recordings").select("*", { count: "exact", head: true }),
    supabase.from("faces").select("*", { count: "exact", head: true }),
  ]);

  const steps: Step[] = [
    {
      title: t("setup_s1_title"),
      desc: t("setup_s1_desc"),
      done: (cameraCount ?? 0) > 0,
      href: "/cameras",
    },
    {
      title: t("setup_s2_title"),
      desc: t("setup_s2_desc"),
      done: (recordingCount ?? 0) > 0,
      href: "/live",
    },
    {
      title: t("setup_s3_title"),
      desc: t("setup_s3_desc"),
      done: (suspectCount ?? 0) > 0,
      href: "/suspects",
    },
    {
      title: t("setup_s4_title"),
      desc: t("setup_s4_desc"),
      done: (faceCount ?? 0) > 0,
      href: "/faces",
    },
    {
      title: t("setup_s5_title"),
      desc: t("setup_s5_desc"),
      done: Boolean(profile.totp_enabled),
      href: "/settings",
    },
    {
      title: t("setup_s6_title"),
      desc: t("setup_s6_desc"),
      done: false,
      href: "/health",
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title={t("setup_title")}
        subtitle={`${completed} / ${steps.length} ${t("setup_completed")}`}
      />

      <div className="max-w-2xl space-y-3">
        {steps.map((step, i) => (
          <Link
            key={i}
            href={step.href}
            className="card flex items-center gap-4 hover:bg-text-muted/[0.02] transition"
          >
            {step.done ? (
              <CheckCircle className="w-6 h-6 text-success shrink-0" />
            ) : (
              <Circle className="w-6 h-6 text-text-faint shrink-0" />
            )}
            <div className="flex-1">
              <div className={`text-sm font-medium ${step.done ? "text-text-muted line-through" : "text-text"}`}>
                {step.title}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{step.desc}</div>
            </div>
            {!step.done && <ArrowRight className="w-4 h-4 text-accent shrink-0" />}
          </Link>
        ))}

        <div className="card bg-accent/5 border border-accent/20 text-xs text-text-soft leading-relaxed">
          {t("setup_footer")}
        </div>
      </div>
    </>
  );
}
