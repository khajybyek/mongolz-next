-- Switch Telegram trigger to async fire-and-forget via pg_net.
-- Previously used extensions.http_post (sync) which would block the alert INSERT.

CREATE OR REPLACE FUNCTION public.notify_telegram_on_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net', 'vault'
AS $function$
DECLARE
  edge_url TEXT;
  service_key TEXT;
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

  -- pg_net async POST — fire-and-forget, does not block INSERT.
  PERFORM net.http_post(
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
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$function$;;
