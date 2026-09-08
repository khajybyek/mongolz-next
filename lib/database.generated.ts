export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_rules: {
        Row: {
          burst_count: number
          burst_window_sec: number
          camera_id: string | null
          created_at: string
          created_by: string | null
          dedup_window_sec: number
          enabled: boolean
          id: string
          min_similarity: number
          name: string
          quiet_from: string | null
          quiet_to: string | null
          suspect_id: string | null
        }
        Insert: {
          burst_count?: number
          burst_window_sec?: number
          camera_id?: string | null
          created_at?: string
          created_by?: string | null
          dedup_window_sec?: number
          enabled?: boolean
          id?: string
          min_similarity?: number
          name: string
          quiet_from?: string | null
          quiet_to?: string | null
          suspect_id?: string | null
        }
        Update: {
          burst_count?: number
          burst_window_sec?: number
          camera_id?: string | null
          created_at?: string
          created_by?: string | null
          dedup_window_sec?: number
          enabled?: boolean
          id?: string
          min_similarity?: number
          name?: string
          quiet_from?: string | null
          quiet_to?: string | null
          suspect_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_suspect_id_fkey"
            columns: ["suspect_id"]
            isOneToOne: false
            referencedRelation: "suspects"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          anomaly_z: number | null
          camera_id: string | null
          camera_name: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          dedup_key: string | null
          face_id: string | null
          id: string
          label: Database["public"]["Enums"]["alert_label"]
          labeled_at: string | null
          labeled_by: string | null
          last_seen_at: string | null
          match_count: number
          note: string | null
          rule_id: string | null
          screenshot_path: string | null
          similarity: number
          state: string
          suspect_id: string | null
          suspect_name: string
          type: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          anomaly_z?: number | null
          camera_id?: string | null
          camera_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          dedup_key?: string | null
          face_id?: string | null
          id?: string
          label?: Database["public"]["Enums"]["alert_label"]
          labeled_at?: string | null
          labeled_by?: string | null
          last_seen_at?: string | null
          match_count?: number
          note?: string | null
          rule_id?: string | null
          screenshot_path?: string | null
          similarity: number
          state?: string
          suspect_id?: string | null
          suspect_name: string
          type?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          anomaly_z?: number | null
          camera_id?: string | null
          camera_name?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          dedup_key?: string | null
          face_id?: string | null
          id?: string
          label?: Database["public"]["Enums"]["alert_label"]
          labeled_at?: string | null
          labeled_by?: string | null
          last_seen_at?: string | null
          match_count?: number
          note?: string | null
          rule_id?: string | null
          screenshot_path?: string | null
          similarity?: number
          state?: string
          suspect_id?: string | null
          suspect_name?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_suspect_id_fkey"
            columns: ["suspect_id"]
            isOneToOne: false
            referencedRelation: "suspects"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          detail: string | null
          id: number
          ip: unknown
          prev_hash: string | null
          row_hash: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          detail?: string | null
          id?: number
          ip?: unknown
          prev_hash?: string | null
          row_hash?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          detail?: string | null
          id?: number
          ip?: unknown
          prev_hash?: string | null
          row_hash?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      camera_permissions: {
        Row: {
          camera_id: string
          created_at: string
          created_by: string | null
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          camera_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          permission?: string
          user_id: string
        }
        Update: {
          camera_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_permissions_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      camera_sessions: {
        Row: {
          auto_resume: boolean
          camera_id: string
          camera_name: string | null
          fps: number
          last_error: string | null
          last_heartbeat_at: string | null
          sealed_url: string
          started_at: string
          updated_at: string
        }
        Insert: {
          auto_resume?: boolean
          camera_id: string
          camera_name?: string | null
          fps?: number
          last_error?: string | null
          last_heartbeat_at?: string | null
          sealed_url: string
          started_at?: string
          updated_at?: string
        }
        Update: {
          auto_resume?: boolean
          camera_id?: string
          camera_name?: string | null
          fps?: number
          last_error?: string | null
          last_heartbeat_at?: string | null
          sealed_url?: string
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_sessions_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: true
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      cameras: {
        Row: {
          cam_type: string
          consent_required: boolean
          consent_text: string | null
          created_at: string
          created_by: string | null
          enabled: boolean
          id: string
          mask_default: string
          name: string
          url: string
        }
        Insert: {
          cam_type?: string
          consent_required?: boolean
          consent_text?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          mask_default?: string
          name: string
          url: string
        }
        Update: {
          cam_type?: string
          consent_required?: boolean
          consent_text?: string | null
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          id?: string
          mask_default?: string
          name?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "cameras_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clusters: {
        Row: {
          cluster_id: number
          face_id: string
          id: number
          updated_at: string
        }
        Insert: {
          cluster_id: number
          face_id: string
          id?: number
          updated_at?: string
        }
        Update: {
          cluster_id?: number
          face_id?: string
          id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clusters_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
        ]
      }
      faces: {
        Row: {
          bbox: Json | null
          camera_id: string | null
          chain_index: number | null
          cluster_id: number | null
          crop_sealed: boolean
          detected_at: string
          embedding: string
          embedding_sealed: string | null
          filename: string
          id: string
          image_path: string
          recording_id: string | null
          review_label: string | null
          reviewed: boolean
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          bbox?: Json | null
          camera_id?: string | null
          chain_index?: number | null
          cluster_id?: number | null
          crop_sealed?: boolean
          detected_at?: string
          embedding: string
          embedding_sealed?: string | null
          filename: string
          id?: string
          image_path: string
          recording_id?: string | null
          review_label?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          bbox?: Json | null
          camera_id?: string | null
          chain_index?: number | null
          cluster_id?: number | null
          crop_sealed?: boolean
          detected_at?: string
          embedding?: string
          embedding_sealed?: string | null
          filename?: string
          id?: string
          image_path?: string
          recording_id?: string | null
          review_label?: string | null
          reviewed?: boolean
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faces_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faces_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faces_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      masking_schedules: {
        Row: {
          camera_id: string
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          note: string | null
          starts_at: string
          weekdays: number
          window_mode: string
        }
        Insert: {
          camera_id: string
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          note?: string | null
          starts_at: string
          weekdays?: number
          window_mode: string
        }
        Update: {
          camera_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          note?: string | null
          starts_at?: string
          weekdays?: number
          window_mode?: string
        }
        Relationships: [
          {
            foreignKeyName: "masking_schedules_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      privacy_zones: {
        Row: {
          camera_id: string
          created_at: string
          created_by: string | null
          enabled: boolean
          enforce_vip_mask: boolean
          h: number
          id: string
          name: string
          never_reveal: boolean
          reason: string | null
          w: number
          x: number
          y: number
        }
        Insert: {
          camera_id: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          enforce_vip_mask?: boolean
          h: number
          id?: string
          name: string
          never_reveal?: boolean
          reason?: string | null
          w: number
          x: number
          y: number
        }
        Update: {
          camera_id?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          enforce_vip_mask?: boolean
          h?: number
          id?: string
          name?: string
          never_reveal?: boolean
          reason?: string | null
          w?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "privacy_zones_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "privacy_zones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_super_admin: boolean
          reveal_level: number
          role: Database["public"]["Enums"]["user_role"]
          totp_enabled: boolean
          totp_recovery_codes: string[]
          totp_secret: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_super_admin?: boolean
          reveal_level?: number
          role?: Database["public"]["Enums"]["user_role"]
          totp_enabled?: boolean
          totp_recovery_codes?: string[]
          totp_secret?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_super_admin?: boolean
          reveal_level?: number
          role?: Database["public"]["Enums"]["user_role"]
          totp_enabled?: boolean
          totp_recovery_codes?: string[]
          totp_secret?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          enabled: boolean
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          ua: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          enabled?: boolean
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          ua?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          enabled?: boolean
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          ua?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          blur_strategy: string
          camera_id: string | null
          camera_name: string | null
          chunk_index: number | null
          duration_sec: number | null
          encrypted: boolean
          ended_at: string | null
          filename: string
          has_original: boolean
          id: string
          is_chunk: boolean
          original_path: string | null
          session_id: string | null
          size_bytes: number | null
          started_at: string
          storage_path: string
        }
        Insert: {
          blur_strategy?: string
          camera_id?: string | null
          camera_name?: string | null
          chunk_index?: number | null
          duration_sec?: number | null
          encrypted?: boolean
          ended_at?: string | null
          filename: string
          has_original?: boolean
          id?: string
          is_chunk?: boolean
          original_path?: string | null
          session_id?: string | null
          size_bytes?: number | null
          started_at?: string
          storage_path: string
        }
        Update: {
          blur_strategy?: string
          camera_id?: string | null
          camera_name?: string | null
          chunk_index?: number | null
          duration_sec?: number | null
          encrypted?: boolean
          ended_at?: string | null
          filename?: string
          has_original?: boolean
          id?: string
          is_chunk?: boolean
          original_path?: string | null
          session_id?: string | null
          size_bytes?: number | null
          started_at?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "recordings_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_deletion_queue: {
        Row: {
          attempts: number
          available_at: string
          bucket: string
          created_at: string
          id: string
          last_error: string | null
          lease_token: string | null
          locked_until: string | null
          object_path: string
        }
        Insert: {
          attempts?: number
          available_at?: string
          bucket: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_until?: string | null
          object_path: string
        }
        Update: {
          attempts?: number
          available_at?: string
          bucket?: string
          created_at?: string
          id?: string
          last_error?: string | null
          lease_token?: string | null
          locked_until?: string | null
          object_path?: string
        }
        Relationships: []
      }
      retention_policies: {
        Row: {
          enabled: boolean
          last_swept_at: string | null
          last_swept_rows: number | null
          resource: string
          retention_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          last_swept_at?: string | null
          last_swept_rows?: number | null
          resource: string
          retention_days: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          last_swept_at?: string | null
          last_swept_rows?: number | null
          resource?: string
          retention_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      reveal_jobs: {
        Row: {
          approval_required: boolean
          approved_at: string | null
          approved_by: string | null
          approved_email: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          face_id: string | null
          face_ids: string[] | null
          id: string
          method: Database["public"]["Enums"]["reveal_method"]
          output_duration_sec: number | null
          output_path: string | null
          progress: number
          query_embedding: string | null
          query_embeddings: Json | null
          reason: string | null
          reauth_at: string | null
          recording_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejected_email: string | null
          rejected_reason: string | null
          requested_by: string | null
          requested_email: string | null
          reveal_level: number
          started_at: string | null
          status: Database["public"]["Enums"]["reveal_status"]
          suspect_id: string | null
          target_end_sec: number | null
          target_start_sec: number | null
          threshold: number
        }
        Insert: {
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          approved_email?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          face_id?: string | null
          face_ids?: string[] | null
          id?: string
          method: Database["public"]["Enums"]["reveal_method"]
          output_duration_sec?: number | null
          output_path?: string | null
          progress?: number
          query_embedding?: string | null
          query_embeddings?: Json | null
          reason?: string | null
          reauth_at?: string | null
          recording_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_email?: string | null
          rejected_reason?: string | null
          requested_by?: string | null
          requested_email?: string | null
          reveal_level?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["reveal_status"]
          suspect_id?: string | null
          target_end_sec?: number | null
          target_start_sec?: number | null
          threshold?: number
        }
        Update: {
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          approved_email?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          face_id?: string | null
          face_ids?: string[] | null
          id?: string
          method?: Database["public"]["Enums"]["reveal_method"]
          output_duration_sec?: number | null
          output_path?: string | null
          progress?: number
          query_embedding?: string | null
          query_embeddings?: Json | null
          reason?: string | null
          reauth_at?: string | null
          recording_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_email?: string | null
          rejected_reason?: string | null
          requested_by?: string | null
          requested_email?: string | null
          reveal_level?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["reveal_status"]
          suspect_id?: string | null
          target_end_sec?: number | null
          target_start_sec?: number | null
          threshold?: number
        }
        Relationships: [
          {
            foreignKeyName: "reveal_jobs_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reveal_jobs_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reveal_jobs_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reveal_jobs_suspect_id_fkey"
            columns: ["suspect_id"]
            isOneToOne: false
            referencedRelation: "suspects"
            referencedColumns: ["id"]
          },
        ]
      }
      suspects: {
        Row: {
          created_at: string
          created_by: string | null
          embedding: string
          id: string
          image_path: string
          name: string
          notes: string | null
          privacy_tier: Database["public"]["Enums"]["suspect_privacy_tier"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          embedding: string
          id?: string
          image_path: string
          name: string
          notes?: string | null
          privacy_tier?: Database["public"]["Enums"]["suspect_privacy_tier"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          embedding?: string
          id?: string
          image_path?: string
          name?: string
          notes?: string | null
          privacy_tier?: Database["public"]["Enums"]["suspect_privacy_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "suspects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      totp_used_codes: {
        Row: {
          code_hash: string
          expires_at: string
          used_at: string
          user_id: string
        }
        Insert: {
          code_hash: string
          expires_at: string
          used_at?: string
          user_id: string
        }
        Update: {
          code_hash?: string
          expires_at?: string
          used_at?: string
          user_id?: string
        }
        Relationships: []
      }
      uptime_checks: {
        Row: {
          checked_at: string
          db_ok: boolean | null
          http_status: number | null
          id: number
          ml_ok: boolean | null
          notified: string | null
          request_id: number | null
          status: string | null
        }
        Insert: {
          checked_at?: string
          db_ok?: boolean | null
          http_status?: number | null
          id?: never
          ml_ok?: boolean | null
          notified?: string | null
          request_id?: number | null
          status?: string | null
        }
        Update: {
          checked_at?: string
          db_ok?: boolean | null
          http_status?: number | null
          id?: never
          ml_ok?: boolean | null
          notified?: string | null
          request_id?: number | null
          status?: string | null
        }
        Relationships: []
      }
      web_vitals: {
        Row: {
          id: number
          metric: string
          navigation_type: string | null
          page: string
          rating: string | null
          session_id: string
          ts: string
          ua: string | null
          user_id: string | null
          value: number
        }
        Insert: {
          id?: number
          metric: string
          navigation_type?: string | null
          page: string
          rating?: string | null
          session_id: string
          ts?: string
          ua?: string | null
          user_id?: string | null
          value: number
        }
        Update: {
          id?: number
          metric?: string
          navigation_type?: string | null
          page?: string
          rating?: string | null
          session_id?: string
          ts?: string
          ua?: string | null
          user_id?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "web_vitals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_challenges: {
        Row: {
          challenge: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          user_id: string
        }
        Insert: {
          challenge: string
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          user_id: string
        }
        Update: {
          challenge?: string
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      webauthn_credentials: {
        Row: {
          counter: number
          created_at: string
          credential_id: string
          device_name: string | null
          id: string
          last_used_at: string | null
          public_key: string
          transports: string[]
          user_id: string
        }
        Insert: {
          counter?: number
          created_at?: string
          credential_id: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key: string
          transports?: string[]
          user_id: string
        }
        Update: {
          counter?: number
          created_at?: string
          credential_id?: string
          device_name?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string
          transports?: string[]
          user_id?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          events: string[]
          fail_count: number
          id: string
          kind: string
          last_fired_at: string | null
          last_status: number | null
          name: string
          signing_secret: string | null
          url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          events?: string[]
          fail_count?: number
          id?: string
          kind: string
          last_fired_at?: string | null
          last_status?: number | null
          name: string
          signing_secret?: string | null
          url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          events?: string[]
          fail_count?: number
          id?: string
          kind?: string
          last_fired_at?: string | null
          last_status?: number | null
          name?: string
          signing_secret?: string | null
          url?: string
        }
        Relationships: []
      }
    }
    Views: {
      alerts_by_date: {
        Row: {
          c: number | null
          d: string | null
        }
        Relationships: []
      }
      audit_actions: {
        Row: {
          action: string | null
        }
        Relationships: []
      }
      faces_by_date: {
        Row: {
          c: number | null
          d: string | null
        }
        Relationships: []
      }
      faces_by_hour: {
        Row: {
          c: number | null
          h: number | null
        }
        Relationships: []
      }
      top_suspects: {
        Row: {
          c: number | null
          suspect_name: string | null
        }
        Relationships: []
      }
      web_vitals_p75: {
        Row: {
          day: string | null
          metric: string | null
          p50: number | null
          p75: number | null
          p95: number | null
          page: string | null
          samples: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      alerts_daily_kst: {
        Args: { p_days?: number }
        Returns: {
          day_kst: string
          n_high: number
          n_total: number
        }[]
      }
      alerts_severity_kst: {
        Args: { p_days?: number }
        Returns: {
          n_high: number
          n_low: number
          n_medium: number
          n_total: number
        }[]
      }
      camera_anomaly_scores: {
        Args: { p_baseline_days?: number; p_window_hours?: number }
        Returns: {
          baseline_mad: number
          baseline_median: number
          bucket_start: string
          camera_id: string
          camera_name: string
          observed: number
          z_score: number
        }[]
      }
      camera_health: {
        Args: never
        Returns: {
          cam_type: string
          camera_id: string
          capturing: boolean
          detection_status: string
          enabled: boolean
          faces_1h: number
          faces_24h: number
          last_heartbeat: string
          last_seen: string
          name: string
          status: string
        }[]
      }
      camera_trail: {
        Args: {
          p_face_id: string
          p_max_results?: number
          p_threshold?: number
          p_window_hours?: number
        }
        Returns: {
          bbox: Json
          camera_id: string
          camera_name: string
          detected_at: string
          face_id: string
          image_path: string
          recording_id: string
          similarity: number
        }[]
      }
      claim_retention_deletions: {
        Args: { p_limit?: number }
        Returns: {
          bucket: string
          id: string
          lease_token: string
          object_path: string
        }[]
      }
      consume_recovery_code: {
        Args: { p_code_hash: string; p_user_id: string }
        Returns: boolean
      }
      consume_totp_code: {
        Args: { p_code_hash: string; p_ttl_sec?: number; p_user_id: string }
        Returns: boolean
      }
      effective_mask_mode: {
        Args: { p_at?: string; p_camera_id: string }
        Returns: string
      }
      email_for_username: { Args: { p_username: string }; Returns: string }
      face_in_privacy_zone: { Args: { p_face_id: string }; Returns: boolean }
      faces_daily_kst: {
        Args: { p_days?: number }
        Returns: {
          day_kst: string
          n_faces: number
        }[]
      }
      faces_hourly_kst: {
        Args: { p_days?: number }
        Returns: {
          hour_kst: number
          n_faces: number
        }[]
      }
      faces_in_recording: {
        Args: { rec_id: string }
        Returns: {
          bbox: Json
          chain_index: number
          crop_sealed: boolean
          detected_at: string
          filename: string
          id: string
          image_path: string
          time_in_video_sec: number
        }[]
      }
      insert_anomaly_alert: {
        Args: {
          p_baseline: number
          p_bucket_start: string
          p_camera_id: string
          p_camera_name: string
          p_observed: number
          p_z: number
        }
        Returns: string
      }
      match_faces: {
        Args: {
          match_limit?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          detected_at: string
          filename: string
          id: string
          image_path: string
          similarity: number
        }[]
      }
      match_suspects: {
        Args: {
          match_limit?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          id: string
          image_path: string
          name: string
          similarity: number
        }[]
      }
      mfa_status: { Args: never; Returns: Json }
      ping: { Args: never; Returns: boolean }
      rate_limit_hit: {
        Args: {
          p_cost?: number
          p_key: string
          p_max: number
          p_window_sec: number
        }
        Returns: Json
      }
      rate_limit_release: {
        Args: { p_cost?: number; p_key: string; p_window_sec: number }
        Returns: undefined
      }
      settle_retention_deletions: {
        Args: { p_error?: string; p_ids: string[]; p_lease_token: string }
        Returns: number
      }
      suggested_threshold: {
        Args: { p_suspect_id: string }
        Returns: {
          fp_count: number
          suggested_threshold: number
          suspect_id: string
          total_labeled: number
          tp_count: number
        }[]
      }
      sweep_retention: { Args: never; Returns: Json }
      top_slow_queries: {
        Args: { p_limit?: number }
        Returns: {
          calls: number
          mean_ms: number
          query: string
          rows_avg: number
          total_ms: number
        }[]
      }
      top_suspects_kst: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          n_alerts: number
          suspect: string
        }[]
      }
      user_can_see_camera: { Args: { p_camera_id: string }; Returns: boolean }
      verify_audit_chain: {
        Args: never
        Returns: {
          action: string
          actual_hash: string
          created_at: string
          expected_hash: string
          id: number
        }[]
      }
    }
    Enums: {
      alert_label: "true_positive" | "false_positive" | "unknown"
      reveal_method: "upload" | "suspect" | "detected_face"
      reveal_status:
        | "pending_approval"
        | "queued"
        | "processing"
        | "completed"
        | "failed"
        | "rejected"
      suspect_privacy_tier: "vip" | "standard" | "relaxed"
      user_role: "admin" | "viewer" | "auditor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_label: ["true_positive", "false_positive", "unknown"],
      reveal_method: ["upload", "suspect", "detected_face"],
      reveal_status: [
        "pending_approval",
        "queued",
        "processing",
        "completed",
        "failed",
        "rejected",
      ],
      suspect_privacy_tier: ["vip", "standard", "relaxed"],
      user_role: ["admin", "viewer", "auditor"],
    },
  },
} as const
