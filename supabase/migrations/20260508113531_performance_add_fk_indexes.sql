
CREATE INDEX IF NOT EXISTS idx_cameras_created_by ON public.cameras(created_by);
CREATE INDEX IF NOT EXISTS idx_suspects_created_by ON public.suspects(created_by);
CREATE INDEX IF NOT EXISTS idx_alerts_camera_id ON public.alerts(camera_id);
CREATE INDEX IF NOT EXISTS idx_alerts_face_id ON public.alerts(face_id);
CREATE INDEX IF NOT EXISTS idx_clusters_face_id ON public.clusters(face_id);
CREATE INDEX IF NOT EXISTS idx_reveal_jobs_face_id ON public.reveal_jobs(face_id);
CREATE INDEX IF NOT EXISTS idx_reveal_jobs_requested_by ON public.reveal_jobs(requested_by);
CREATE INDEX IF NOT EXISTS idx_reveal_jobs_suspect_id ON public.reveal_jobs(suspect_id);
;
