import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    try {
      const svc = createServiceClient();
      await svc.from("audit_log").insert({
        action: "LOGOUT",
        user_id: user.id,
        user_email: user.email,
      });
    } catch {
      // ignore
    }
  }

  await supabase.auth.signOut();
  try {
    const { clearSessionPin } = await import("@/lib/auth/session-pin");
    await clearSessionPin();
  } catch {
    // ignore
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
