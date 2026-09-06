-- Allow the built-in demo camera type (demo://lobby|gate|parking) — the web
-- layer and ML service accept it; the initial-schema CHECK did not.
-- safety: ok — same constraint re-added immediately with one extra value; no rows can become invalid.
alter table public.cameras drop constraint if exists cameras_cam_type_check;
alter table public.cameras
  add constraint cameras_cam_type_check
  check (cam_type in ('rtsp', 'http', 'usb', 'webcam', 'demo'));
