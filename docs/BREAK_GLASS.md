# Break-Glass Procedures

These are **last-resort** operator procedures for when the in-app flow has failed.  Anything below requires `SUPABASE_SERVICE_ROLE_KEY` access (Vercel env or Supabase dashboard owner).

> ⚠️ Every break-glass action MUST be followed by a manual `audit_log` insert (`BREAK_GLASS_*`) and a same-day team email so the security audit trail stays intact.

---

## 1. Admin lost TOTP (no recovery codes left)

**Symptom:** `admin@mongolz.local` (or another admin) cannot log in because:
- Their authenticator app is gone (lost / new phone / wiped device)
- All 10 single-use recovery codes have been consumed

**Resolution:**
1. Open Supabase Dashboard → SQL Editor.
2. Verify the admin profile:
   ```sql
   SELECT id, email, role, totp_enabled, array_length(totp_recovery_codes, 1) AS codes
     FROM profiles
    WHERE email = 'admin@mongolz.local';
   ```
3. Disable TOTP for that profile:
   ```sql
   UPDATE profiles
      SET totp_enabled = false,
          totp_secret  = NULL,
          totp_recovery_codes = '{}'
    WHERE email = 'admin@mongolz.local';
   ```
4. Record the action:
   ```sql
   INSERT INTO audit_log (action, detail, user_email)
   VALUES ('BREAK_GLASS_TOTP_RESET',
           'Disabled TOTP for admin@mongolz.local — operator: <YOUR_NAME>',
           'admin@mongolz.local');
   ```
5. Inform the admin to log in immediately and re-enable TOTP at `/settings`.
6. Send the team a brief email summarising who did what and why.

The middleware will redirect them to `/settings?force_totp=1` until they re-enable.

---

## 2. Lost SUPABASE_SERVICE_ROLE_KEY (suspected leak)

**Resolution:**
1. Vercel → Settings → Environment Variables → rotate `SUPABASE_SERVICE_ROLE_KEY`.
2. Update Railway + any local `.env.production.tmp`.
3. Inside the Supabase Dashboard, **revoke the old key** under Settings → API.
4. Update `audit_log` with `BREAK_GLASS_KEY_ROTATION`.
5. Force-redeploy Vercel + Railway.

---

## 3. ADMIN_COUNT_ZERO alert fired

`deleteUserAction` writes `ADMIN_COUNT_ZERO` to `audit_log` when a race condition removed the last admin. To recover:

```sql
-- Promote a viewer / auditor back to admin
UPDATE profiles
   SET role = 'admin'
 WHERE email = '<TRUSTED_VIEWER_EMAIL>';

INSERT INTO audit_log (action, detail, user_email)
VALUES ('BREAK_GLASS_ADMIN_RESTORE',
        'Promoted <email> to admin after ADMIN_COUNT_ZERO',
        '<TRUSTED_VIEWER_EMAIL>');
```

Send a same-day notification to the team listing what happened and who is now an admin.

---

## 4. AES-256-GCM data key compromise

If `ML_ENCRYPTION_KEY` is known to have leaked, follow the **dual-key rotation** procedure documented in CLAUDE.md → "Key Rotation Procedure" (sets `ML_ENCRYPTION_KEY_PREV` so existing recordings remain decryptable while new files use the rotated key).

After rotation, optionally re-encrypt historical recordings with a maintenance script.

---

## 5. Audit chain integrity broken

If `verify_audit_chain()` returns ANY mismatch:

```sql
SELECT * FROM verify_audit_chain();   -- returns ONLY broken rows; empty = healthy
```

Each mismatch row is a tampering indicator. Preserve forensic state:
1. **Do NOT** run any backfill — the broken chain IS the evidence.
2. Export the affected rows + immediate neighbours.
3. Investigate which `service_role` actor wrote to `audit_log` (Supabase logs).
4. Escalate to project owner before any restorative action.

---

## Drill (recommended once per semester)

1. Simulate the "all admins lost TOTP" scenario on a staging copy.
2. Time the response from alert → recovery.
3. Update this document if any step felt unclear.
