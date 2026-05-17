
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.notify_telegram_on_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  edge_url TEXT;
  service_key TEXT;
  request_id BIGINT;
BEGIN
  edge_url := current_setting('app.settings.edge_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  IF edge_url IS NULL OR edge_url = '' OR service_key IS NULL OR service_key = '' THEN
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

DROP TRIGGER IF EXISTS trigger_telegram_on_alert ON public.alerts;
CREATE TRIGGER trigger_telegram_on_alert
AFTER INSERT ON public.alerts
FOR EACH ROW
EXECUTE FUNCTION public.notify_telegram_on_alert();

COMMENT ON FUNCTION public.notify_telegram_on_alert() IS
'Telegram alert webhook trigger. Reads app.settings.edge_url + app.settings.service_role_key. Set via: ALTER DATABASE postgres SET app.settings.edge_url = ''https://PROJECT.supabase.co'';';
;
