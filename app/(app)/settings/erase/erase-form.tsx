"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";

interface Props {
  email: string;
  role: "admin" | "viewer" | "auditor";
  totpEnabled: boolean;
}

export function EraseForm({ email, role, totpEnabled }: Props) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/gdpr/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm,
          totp_code: totpEnabled ? totp : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      // Logged out — go to login
      router.push(("/login?error=" + encodeURIComponent("Account erased")) as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card border border-danger/30 bg-danger/[0.04] space-y-3">
      <div className="flex items-start gap-2.5 text-warning">
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="text-sm leading-relaxed">
          <p className="font-semibold mb-1">⚠ Энэ үйлдэл буцаашгүй.</p>
          <ul className="text-xs text-neutral-300 space-y-1 list-disc list-inside">
            <li>Профайл устгагдана</li>
            <li>Auth row устгагдана (нэвтрэх боломжгүй)</li>
            <li>
              Audit log нь хадгалагдана — гэхдээ user_id NULL болж anonymise
              хийгдэнэ
            </li>
            <li>Тоглуулсан labels болон reveal job-ууд хадгалагдаж SET NULL</li>
            <li>Camera permission бүгд цуцлагдана</li>
            {role === "admin" && (
              <li>
                Хэрэв та сүүлчийн admin бол өөр admin томилох хүртэл устгах
                боломжгүй.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
          Имэйл (баталгаа)
        </label>
        <input value={email} disabled className="input opacity-60" />
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
          Үнэхээр устгахыг хүсэж байгаагаа баталгаажуулна уу
        </label>
        <input
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="DELETE MY ACCOUNT гэж бичнэ үү"
          className="input"
          autoComplete="off"
        />
      </div>

      {totpEnabled && (
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-400 mb-1.5 block">
            TOTP 6-digit код
          </label>
          <input
            required
            value={totp}
            onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
            maxLength={6}
            inputMode="numeric"
            pattern="\d{6}"
            placeholder="000000"
            className="input text-center text-lg tracking-widest"
          />
        </div>
      )}

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || confirm !== "DELETE MY ACCOUNT" || (totpEnabled && totp.length !== 6)}
        className="btn-danger w-full"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Бүртгэлийг устгах
      </button>
    </form>
  );
}
