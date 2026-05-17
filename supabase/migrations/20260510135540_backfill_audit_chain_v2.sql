
-- Trigger түр зогсоож, бүх hash-ыг дахин бодож, дараа нь сэргээнэ
ALTER TABLE audit_log DISABLE TRIGGER USER;

DO $$
DECLARE
  rec record;
  last_hash text := repeat('0', 64);
  payload text;
  computed_hash text;
BEGIN
  FOR rec IN SELECT * FROM audit_log ORDER BY id ASC LOOP
    payload := concat_ws('|',
      last_hash,
      rec.action,
      coalesce(rec.detail, ''),
      coalesce(rec.user_id::text, ''),
      coalesce(rec.user_email, ''),
      rec.created_at::text
    );
    computed_hash := encode(extensions.digest(payload, 'sha256'), 'hex');
    UPDATE audit_log SET row_hash = computed_hash WHERE id = rec.id;
    last_hash := computed_hash;
  END LOOP;
END $$;

ALTER TABLE audit_log ENABLE TRIGGER USER;
;
