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
          name: string
          privacy_default: string
          privacy_loosened_at: string | null
          recording_mode: string
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
          name: string
          privacy_default?: string
          privacy_loosened_at?: string | null
          recording_mode?: string
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
          name?: string
          privacy_default?: string
          privacy_loosened_at?: string | null
          recording_mode?: string
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
      edge_agents: {
        Row: {
          camera_id: string
          capture_enabled: boolean
          created_at: string
          failed_total: number
          id: string
          last_error: string | null
          last_seen_at: string
          name: string
          oldest_queued_at: string | null
          queue_depth: number
          sent_total: number
          state: string
          updated_at: string
          version: string
        }
        Insert: {
          camera_id: string
          capture_enabled?: boolean
          created_at?: string
          failed_total?: number
          id: string
          last_error?: string | null
          last_seen_at?: string
          name: string
          oldest_queued_at?: string | null
          queue_depth?: number
          sent_total?: number
          state?: string
          updated_at?: string
          version: string
        }
        Update: {
          camera_id?: string
          capture_enabled?: boolean
          created_at?: string
          failed_total?: number
          id?: string
          last_error?: string | null
          last_seen_at?: string
          name?: string
          oldest_queued_at?: string | null
          queue_depth?: number
          sent_total?: number
          state?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "edge_agents_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      edge_ingest_events: {
        Row: {
          agent_id: string
          camera_id: string
          captured_at: string
          face_count: number
          id: string
          payload_sha256: string
          received_at: string
        }
        Insert: {
          agent_id: string
          camera_id: string
          captured_at: string
          face_count: number
          id: string
          payload_sha256: string
          received_at?: string
        }
        Update: {
          agent_id?: string
          camera_id?: string
          captured_at?: string
          face_count?: number
          id?: string
          payload_sha256?: string
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "edge_ingest_events_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "edge_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edge_ingest_events_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      face_search_presets: {
        Row: {
          camera_id: string | null
          created_at: string
          from_at: string | null
          id: string
          incident_id: string | null
          match_threshold: number
          min_confidence: number | null
          name: string
          recording_status: string | null
          result_limit: number
          suspect_id: string | null
          to_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          camera_id?: string | null
          created_at?: string
          from_at?: string | null
          id?: string
          incident_id?: string | null
          match_threshold?: number
          min_confidence?: number | null
          name: string
          recording_status?: string | null
          result_limit?: number
          suspect_id?: string | null
          to_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          camera_id?: string | null
          created_at?: string
          from_at?: string | null
          id?: string
          incident_id?: string | null
          match_threshold?: number
          min_confidence?: number | null
          name?: string
          recording_status?: string | null
          result_limit?: number
          suspect_id?: string | null
          to_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_search_presets_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_search_presets_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_search_presets_suspect_id_fkey"
            columns: ["suspect_id"]
            isOneToOne: false
            referencedRelation: "suspects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "face_search_presets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          detection_confidence: number | null
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
          source_offset_sec: number | null
        }
        Insert: {
          bbox?: Json | null
          camera_id?: string | null
          chain_index?: number | null
          cluster_id?: number | null
          crop_sealed?: boolean
          detected_at?: string
          detection_confidence?: number | null
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
          source_offset_sec?: number | null
        }
        Update: {
          bbox?: Json | null
          camera_id?: string | null
          chain_index?: number | null
          cluster_id?: number | null
          crop_sealed?: boolean
          detected_at?: string
          detection_confidence?: number | null
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
          source_offset_sec?: number | null
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
      incident_alerts: {
        Row: {
          added_at: string
          added_by: string | null
          alert_id: string
          incident_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          alert_id: string
          incident_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          alert_id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_alerts_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_alerts_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          detail: string | null
          event_type: string
          id: number
          incident_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          event_type: string
          id?: never
          incident_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          event_type?: string
          id?: never
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_evidence_exports: {
        Row: {
          created_at: string
          created_by: string | null
          created_by_email: string | null
          file_count: number
          id: string
          incident_id: string
          manifest_sha256: string
          package_bytes: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          file_count: number
          id?: string
          incident_id: string
          manifest_sha256: string
          package_bytes: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          file_count?: number
          id?: string
          incident_id?: string
          manifest_sha256?: string
          package_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_evidence_exports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_evidence_exports_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_faces: {
        Row: {
          added_at: string
          added_by: string | null
          face_id: string
          incident_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          face_id: string
          incident_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          face_id?: string
          incident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_faces_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_faces_face_id_fkey"
            columns: ["face_id"]
            isOneToOne: false
            referencedRelation: "faces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_faces_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_recordings: {
        Row: {
          added_at: string
          added_by: string | null
          camera_name: string | null
          clip_end_sec: number
          clip_start_sec: number
          hold_released_at: string | null
          hold_released_by: string | null
          id: string
          incident_id: string
          legal_hold: boolean
          note: string | null
          recording_filename: string
          recording_id: string | null
          recording_started_at: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          camera_name?: string | null
          clip_end_sec: number
          clip_start_sec: number
          hold_released_at?: string | null
          hold_released_by?: string | null
          id?: string
          incident_id: string
          legal_hold?: boolean
          note?: string | null
          recording_filename: string
          recording_id?: string | null
          recording_started_at: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          camera_name?: string | null
          clip_end_sec?: number
          clip_start_sec?: number
          hold_released_at?: string | null
          hold_released_by?: string | null
          id?: string
          incident_id?: string
          legal_hold?: boolean
          note?: string | null
          recording_filename?: string
          recording_id?: string | null
          recording_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_recordings_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_recordings_hold_released_by_fkey"
            columns: ["hold_released_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_recordings_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_recordings_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          assignee_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          priority: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          priority?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_resolved_by_fkey"
            columns: ["resolved_by"]
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
      recording_privacy_spans: {
        Row: {
          client_span_id: string
          created_at: string
          end_offset_sec: number | null
          id: number
          recording_id: string
          source: string
          start_offset_sec: number
        }
        Insert: {
          client_span_id?: string
          created_at?: string
          end_offset_sec?: number | null
          id?: never
          recording_id: string
          source?: string
          start_offset_sec: number
        }
        Update: {
          client_span_id?: string
          created_at?: string
          end_offset_sec?: number | null
          id?: never
          recording_id?: string
          source?: string
          start_offset_sec?: number
        }
        Relationships: [
          {
            foreignKeyName: "recording_privacy_spans_recording_id_fkey"
            columns: ["recording_id"]
            isOneToOne: false
            referencedRelation: "recordings"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          blur_strategy: string
          camera_id: string | null
          camera_name: string | null
          capture_error: string | null
          capture_status: string
          chunk_index: number | null
          duration_sec: number | null
          encrypted: boolean
          ended_at: string | null
          face_envelope_path: string | null
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
          capture_error?: string | null
          capture_status?: string
          chunk_index?: number | null
          duration_sec?: number | null
          encrypted?: boolean
          ended_at?: string | null
          face_envelope_path?: string | null
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
          capture_error?: string | null
          capture_status?: string
          chunk_index?: number | null
          duration_sec?: number | null
          encrypted?: boolean
          ended_at?: string | null
          face_envelope_path?: string | null
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
          reference_sealed: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejected_email: string | null
          rejected_reason: string | null
          request_scope: Json | null
          requested_by: string | null
          requested_email: string | null
          reveal_level: number
          started_at: string | null
          status: Database["public"]["Enums"]["reveal_status"]
          suspect_id: string | null
          target_end_sec: number | null
          target_start_sec: number | null
          threshold: number
          worker_attempts: number
          worker_lease_token: string | null
          worker_lease_until: string | null
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
          reference_sealed?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_email?: string | null
          rejected_reason?: string | null
          request_scope?: Json | null
          requested_by?: string | null
          requested_email?: string | null
          reveal_level?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["reveal_status"]
          suspect_id?: string | null
          target_end_sec?: number | null
          target_start_sec?: number | null
          threshold?: number
          worker_attempts?: number
          worker_lease_token?: string | null
          worker_lease_until?: string | null
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
          reference_sealed?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejected_email?: string | null
          rejected_reason?: string | null
          request_scope?: Json | null
          requested_by?: string | null
          requested_email?: string | null
          reveal_level?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["reveal_status"]
          suspect_id?: string | null
          target_end_sec?: number | null
          target_start_sec?: number | null
          threshold?: number
          worker_attempts?: number
          worker_lease_token?: string | null
          worker_lease_until?: string | null
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
      upload_jobs: {
        Row: {
          attempts: number
          camera_name: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          progress: number
          recording_id: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          camera_name: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id: string
          progress?: number
          recording_id: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          camera_name?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          progress?: number
          recording_id?: string
          requested_by?: string
          status?: string
          updated_at?: string
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
          web_ok: boolean | null
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
          web_ok?: boolean | null
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
          web_ok?: boolean | null
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
      attach_incident_alert: {
        Args: { p_alert_id: string; p_incident_id: string }
        Returns: string
      }
      attach_incident_face: {
        Args: { p_face_id: string; p_incident_id: string }
        Returns: string
      }
      attach_incident_recording: {
        Args: {
          p_clip_end_sec: number
          p_clip_start_sec: number
          p_incident_id: string
          p_legal_hold?: boolean
          p_note?: string
          p_recording_id: string
        }
        Returns: string
      }
      backup_missing_storage_objects: {
        Args: { p_bucket: string; p_names: string[] }
        Returns: {
          name: string
        }[]
      }
      bind_mfa_session: {
        Args: { p_method: string; p_session_id: string; p_user_id: string }
        Returns: undefined
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
      claim_reveal_job: { Args: { p_job_id: string }; Returns: string }
      consume_recovery_code: {
        Args: { p_code_hash: string; p_user_id: string }
        Returns: boolean
      }
      consume_totp_code: {
        Args: { p_code_hash: string; p_ttl_sec?: number; p_user_id: string }
        Returns: boolean
      }
      create_incident: {
        Args: {
          p_alert_id?: string
          p_assignee_id?: string
          p_description?: string
          p_priority?: string
          p_title: string
        }
        Returns: string
      }
      effective_privacy_mode: {
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
      log_incident_evidence_export: {
        Args: {
          p_file_count: number
          p_incident_id: string
          p_manifest_sha256: string
          p_package_bytes: number
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
      mfa_session_bound: { Args: { p_session_id: string }; Returns: boolean }
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
      recording_face_counts: {
        Args: { p_recording_ids: string[] }
        Returns: {
          face_count: number
          recording_id: string
        }[]
      }
      release_incident_recording_hold: {
        Args: { p_actor: string; p_evidence_id: string }
        Returns: string
      }
      retention_queue_health: { Args: never; Returns: Json }
      review_face: {
        Args: { p_face_id: string; p_label: string }
        Returns: string
      }
      search_faces_advanced_page: {
        Args: {
          match_threshold?: number
          p_camera_id?: string
          p_from?: string
          p_incident_id?: string
          p_limit?: number
          p_min_confidence?: number
          p_offset?: number
          p_recording_status?: string
          p_suspect_id?: string
          p_to?: string
          query_embedding: string
        }
        Returns: {
          camera_id: string
          camera_name: string
          crop_sealed: boolean
          detected_at: string
          detection_confidence: number
          filename: string
          id: string
          image_path: string
          recording_filename: string
          recording_id: string
          recording_status: string
          similarity: number
          suspect_id: string
          suspect_name: string
        }[]
      }
      search_faces_filtered: {
        Args: {
          match_limit?: number
          match_threshold?: number
          p_camera_id?: string
          p_from?: string
          p_to?: string
          query_embedding: string
        }
        Returns: {
          camera_id: string
          camera_name: string
          crop_sealed: boolean
          detected_at: string
          filename: string
          id: string
          image_path: string
          recording_filename: string
          recording_id: string
          similarity: number
        }[]
      }
      search_faces_filtered_page: {
        Args: {
          match_threshold?: number
          p_camera_id?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_to?: string
          query_embedding: string
        }
        Returns: {
          camera_id: string
          camera_name: string
          crop_sealed: boolean
          detected_at: string
          filename: string
          id: string
          image_path: string
          recording_filename: string
          recording_id: string
          similarity: number
        }[]
      }
      set_incident_recording_hold: {
        Args: { p_evidence_id: string; p_legal_hold: boolean }
        Returns: string
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
      update_incident: {
        Args: {
          p_assignee_id?: string
          p_description: string
          p_expected_updated_at: string
          p_incident_id: string
          p_note?: string
          p_priority: string
          p_status: string
          p_title: string
        }
        Returns: string
      }
      update_reveal_job_lease: {
        Args: { p_fields?: Json; p_job_id: string; p_token: string }
        Returns: boolean
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
