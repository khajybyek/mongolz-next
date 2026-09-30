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

If `ML_ENCRYPTION_KEY` is known to have leaked, rotate it **dual-key** — the outgoing value moves to `ML_ENCRYPTION_KEY_PREV`, so everything already sealed stays readable while new artifacts use the new key:

```bash
npm run rotate:keys -- --key=ML_ENCRYPTION_KEY        # validates the value against the Python parser first
cd ml-service && railway up --detach                   # restart into dual-key mode
```

The script writes an `ML_ENCRYPTION_KEY_ROTATED` audit row, which is what clears the weekly `KEY_ROTATION_DUE` warning (see RUNBOOK §4).

### Keep `ML_ENCRYPTION_KEY_PREV`. There is no re-encryption tool.

Earlier versions of this document promised a "maintenance script" that re-encrypts historical recordings. **It does not exist**, and `npm run rotate:keys -- --key=ML_ENCRYPTION_KEY --finalize` now refuses rather than pretending otherwise. Dropping `ML_ENCRYPTION_KEY_PREV` permanently destroys everything still sealed under the retired key:

- encrypted recordings (`recordings.original_path`, `recordings.storage_path`);
- every sealed face crop and embedding written since Tier 2 — those have **no plaintext copy anywhere**;
- face-encrypted recordings (ADR 0013): the masked video (`recordings.storage_path`) **and** the face envelope (`recordings.face_envelope_path`), whose per-face blobs are sealed under hash-chain keys derived from the same master key — and those recordings have no raw original to fall back on.

Nothing outside the ML container can even count how many of those remain: the per-recording HKDF keys and the per-face hash-chain keys only exist there. Before the gate can open, all of this has to exist first:

1. an ML maintenance endpoint that, per artifact, decrypts with the key candidates, re-encrypts under the active key, verifies the round-trip, replaces the object, and records progress so an interrupted run resumes (sealed crops must keep their chain position);
2. a report from it saying **zero** artifacts decrypt only under the PREV key;
3. a verified backup taken *after* that pass (`npm run backup:verify`).

A retired key sitting in Railway's env costs nothing. Leave it there.

### Accepting the loss deliberately (last resort)

Only if the retired key must be destroyed (e.g. a legal or contractual requirement following the leak) **and** the loss of every artifact still sealed under it is accepted in writing by the project owner:

```bash
cd ml-service
railway variables --unset ML_ENCRYPTION_KEY_PREV      # irreversible
railway up --detach
```

```sql
INSERT INTO audit_log (action, detail, user_email)
VALUES ('BREAK_GLASS_ML_PREV_KEY_DESTROYED',
        'Dropped ML_ENCRYPTION_KEY_PREV without a re-encryption pass — approved by <OWNER>, operator: <YOUR_NAME>',
        '<YOUR_EMAIL>');
```

Then verify what survived (`npm run backup:verify`) and record the count of recordings that no longer decrypt in the same-day email.

### `CAMERA_URL_KEY` is different — that one is verifiable

Camera URLs live in the database, so the script can prove the re-seal finished:

```bash
# Vercel never discloses a stored value, so the outgoing key comes from the vault
# and the new one is captured with --emit (move it into the vault, then delete it):
CAMERA_URL_KEY_CURRENT='<outgoing key>' \
  npm run rotate:keys -- --key=CAMERA_URL_KEY --emit=./camera-url-key.new
vercel deploy --prod --yes
npm run encrypt:camera-urls -- --reencrypt            # repeat until it reports 0
npm run rotate:keys -- --key=CAMERA_URL_KEY --finalize # refuses unless 0 rows are still under the PREV key
```

Without `CAMERA_URL_KEY_CURRENT` the rotation is refused — there would be no `CAMERA_URL_KEY_PREV` and every sealed camera URL would become unreadable. If that key is already lost, re-enter each camera's URL on `/cameras` (saving re-seals it) instead of rotating.

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
