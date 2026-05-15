import { NextResponse, type NextRequest } from "next/server";
import { requireAdminApi, isAuthErr } from "@/lib/supabase/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const LABELS = new Set(["true_positive", "false_positive", "unknown"] as const);
type Label = "true_positive" | "false_positive" | "unknown";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi();
  if (isAuthErr(auth)) return auth.error;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid alert id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const label = body.label as string;
  if (!LABELS.has(label as Label)) {
    return NextResponse.json({ error: "label must be true_positive | false_positive | unknown" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("alerts")
    .update({
      label,
      labeled_by: auth.user.id,
      labeled_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await createServiceClient().from("audit_log").insert({
    action: "ALERT_LABEL",
    detail: `${id} → ${label}`,
    user_id: auth.user.id,
    user_email: auth.user.email,
  });

  return NextResponse.json({ ok: true, label });
}
