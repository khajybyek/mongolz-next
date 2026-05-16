# MONGOLZ Security — Incident Runbook

> On-call playbook. Алдаа гарвал хамгийн түрүүнд энэ document-ыг нэг харж аваарай.

---

## Quick links

- **Production:** https://mongolz.vercel.app
- **ML Service:** https://mongolz-ml-production.up.railway.app
- **Sentry:** https://mongolz.sentry.io/projects/mongolz-next
- **Supabase:** https://supabase.com/dashboard/project/ulybenitqmqjfxtaregp
- **Vercel:** https://vercel.com/mongolz/mongolz

## Common health checks (3 commands)

```bash
# 1. Public uptime probe
curl -s https://mongolz.vercel.app/api/uptime | jq

# 2. ML root
curl https://mongolz-ml-production.up.railway.app/

# 3. Sentry recent errors (last 24h)
sentry-cli issues list --org mongolz --project mongolz-next --query "is:unresolved age:-24h"
```

---

## 🔴 P0 — Production эвдрэв

### Symptom: `/api/uptime` returns 503 or doesn't respond

1. `vercel logs --json | head -50` — Next.js side ажиллаж байгаа эсэх
2. `railway logs --tail 80` — ML service дов байгаа эсэх
3. Supabase status: https://status.supabase.com/

**If Vercel down:** `vercel deploy --prod --yes` (rebuild). Сайжрахгүй бол `vercel rollback`.

**If ML down:**
```bash
cd ml-service
railway logs --tail 200
railway restart
```

**If DB down:** Supabase support. Read replicas автомат failover нь Pro плэйн л.

### Rollback procedure

```bash
# 1. Last good deployment ID-ийг ол
vercel ls --prod | head -5

# 2. Promote good one back to production
vercel promote <good-deployment-url>

# 3. Verify
curl -s https://mongolz.vercel.app/api/uptime
```

---

## 🟠 P1 — ML service фалаад зогссон

### Symptom: ML `/detect` returns 500 / `/embed` хариу өгөхгүй

1. `railway logs --tail 200 | grep -iE "error|exception|killed"`
2. OOM эсэх:
   ```bash
   railway logs --tail 500 | grep "MemoryError\|killed"
   ```
3. **Quick fix:** `railway restart` (10-20 sec downtime)
4. **Long fix:** Если `MemoryError`: ширнэс instance-ыг өргөтгөх (Railway → Resources → 2GB).

### Frontend automatic fallback

`lib/edge-inference/face-detector.ts` нь WebGPU → WASM auto-fallback. ML server doosh бол browser дээр л client-side detection ажиллана.

---

## 🟡 P2 — Key rotation эсвэл compromise

### Suspected ML_SERVICE_TOKEN leak

```bash
npm run rotate:keys -- --key=ML_SERVICE_TOKEN
vercel deploy --prod --yes
```

### Suspected ML_ENCRYPTION_KEY leak

⚠️ **NEVER delete the PREV key before all recordings are re-encrypted.**

```bash
# 1. Rotate
npm run rotate:keys -- --key=ML_ENCRYPTION_KEY

# 2. Старый key автоматаар *_PREV болж хадгалагдана.
#    Old recordings нь ML service-ийн dual-key fallback-аар уншигдсаар байх ёстой.

# 3. Бүх recordings-ыг re-encrypt хий (manual или background job)
# Тэгээд:
npm run rotate:keys -- --key=ML_ENCRYPTION_KEY --finalize
```

### Compromised admin account

1. Supabase dashboard → Authentication → Users → demote сэжигтэй admin → viewer
2. Audit log шалга:
   ```sql
   SELECT * FROM audit_log
   WHERE user_email = 'compromised@example.com'
   ORDER BY created_at DESC LIMIT 100;
   ```
3. Reveal jobs шалгах:
   ```sql
   SELECT * FROM reveal_jobs WHERE requested_by = '<user-uuid>';
   ```
4. Хэрэв reveal хийсэн бол: storage `revealed` bucket-ийн output file-уудыг устга.

---

## 🟢 P3 — Performance degradation

### Slow alerts page

1. `/db-monitor` → top 30 slow queries харах
2. Ихэвчлэн `alerts` table-ийн n+1 query → bulk fetch болгох
3. Эсвэл `match_faces` ivfflat index reindex:
   ```sql
   REINDEX INDEX CONCURRENTLY faces_embedding_ivfflat_idx;
   ```

### High Sentry error volume

1. Sentry → Issues → sort by `frequency`
2. Top 3-ыг шалгах
3. Group fingerprint-аар муу нийтлэг error-ыг silence хийх

---

## Daily / Weekly checklist

### Daily
- [ ] `/api/uptime` ok
- [ ] Sentry "unresolved" count хүлээж буй
- [ ] Backup verify cron pass (audit_log: `BACKUP_VERIFY`)

### Weekly
- [ ] Verify audit chain: `SELECT count(*) FROM verify_audit_chain();` → 0 байх ёстой
- [ ] Retention sweep result шалгах
- [ ] DB performance — slow query top 10 шалгах

### Monthly
- [ ] Key rotation drill (dev environment)
- [ ] Sentry source maps verify (test endpoint)
- [ ] Test admin user creation flow

---

## Phone tree

| Issue | First | Second |
|-------|-------|--------|
| Vercel down | Project owner | Vercel support |
| ML down | Project owner | Railway support |
| DB compromise | Project owner | Supabase support + privacy officer |
| Data breach | Privacy officer | Legal |

---

## Telemetry forwarding

- Sentry → `mongolz` org → `mongolz-next` project
- Slack: `#mongolz-alerts` channel (env `SLACK_ALERT_WEBHOOK`)
- Audit log: in-database (`SELECT * FROM audit_log ORDER BY created_at DESC`)

---

## Glossary

- **Reveal** — Voronoi mosaic блюр-аас оригинал бичлэг сэргээх үйлдэл. 4-eyes принцпийг шаардана.
- **Mask schedule** — Цаг тус бүрд `masked/revealed` горимыг тогтоох per-camera config.
- **Step-up auth** — 15-min cookie-той re-auth для sensitive ops.
- **Session pin** — IP/16 + UA fingerprint HMAC cookie. Stolen cookie replays-ийг таслана.
