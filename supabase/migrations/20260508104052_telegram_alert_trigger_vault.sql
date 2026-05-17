
-- Trigger функц — Vault-аас унших байдлаар шинэчлэх
CREATE OR REPLACE FUNCTION public.notify_telegram_on_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  edge_url TEXT;
  service_key TEXT;
  request_id BIGINT;
BEGIN
  SELECT decrypted_secret INTO edge_url
  FROM vault.decrypted_secrets
  WHERE name = 'edge_url'
  LIMIT 1;

  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  IF edge_url IS NULL OR edge_url = '' OR service_key IS NULL OR service_key = '' THEN
    RAISE LOG 'telegram-alerts: vault secrets not configured';
    RETURN NEW;
  END IF;

  BEGIN
    SELECT extensions.http_post(
      url := edge_url || '/functions/v1/telegram-alerts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object(
        'suspect_name', NEW.suspect_name,
        'similarity', NEW.similarity,
        'camera_name', NEW.camera_name,
        'created_at', NEW.created_at,
        'screenshot_path', NEW.screenshot_path
      )
    ) INTO request_id;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE LOG 'telegram-alerts call failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;
;
