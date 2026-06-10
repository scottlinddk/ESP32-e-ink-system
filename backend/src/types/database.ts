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
      active_alerts: {
        Row: {
          device_id: string
          dismissed_at: string | null
          expires_at: string
          id: string
          rule_id: string
          triggered_at: string
        }
        Insert: {
          device_id: string
          dismissed_at?: string | null
          expires_at: string
          id?: string
          rule_id: string
          triggered_at?: string
        }
        Update: {
          device_id?: string
          dismissed_at?: string | null
          expires_at?: string
          id?: string
          rule_id?: string
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_alerts_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "alert_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_rules: {
        Row: {
          alert_message: string
          condition: Json
          created_at: string
          device_id: string
          duration_seconds: number
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
          widget_id: string
        }
        Insert: {
          alert_message: string
          condition: Json
          created_at?: string
          device_id: string
          duration_seconds?: number
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
          widget_id: string
        }
        Update: {
          alert_message?: string
          condition?: Json
          created_at?: string
          device_id?: string
          duration_seconds?: number
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_rules_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widget_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          api_key: string
          created_at: string | null
          id: string
          provider: string
          user_id: string
        }
        Insert: {
          api_key: string
          created_at?: string | null
          id?: string
          provider: string
          user_id: string
        }
        Update: {
          api_key?: string
          created_at?: string | null
          id?: string
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          called_at: string | null
          endpoint: string | null
          id: string
          user_id: string
        }
        Insert: {
          called_at?: string | null
          endpoint?: string | null
          id?: string
          user_id: string
        }
        Update: {
          called_at?: string | null
          endpoint?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          created_at: string
          device_id: string | null
          device_name: string | null
          firmware_version: string | null
          id: string
          is_active: boolean
          last_seen_at: string | null
          license_key: string
          name: string | null
          screen_profile_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          device_name?: string | null
          firmware_version?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          license_key?: string
          name?: string | null
          screen_profile_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          device_name?: string | null
          firmware_version?: string | null
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          license_key?: string
          name?: string | null
          screen_profile_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_screen_profile_id_fkey"
            columns: ["screen_profile_id"]
            isOneToOne: false
            referencedRelation: "screen_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      firmware_releases: {
        Row: {
          checksum_sha256: string
          created_at: string
          id: string
          is_stable: boolean
          release_notes: string | null
          storage_path: string
          version: string
        }
        Insert: {
          checksum_sha256: string
          created_at?: string
          id?: string
          is_stable?: boolean
          release_notes?: string | null
          storage_path: string
          version: string
        }
        Update: {
          checksum_sha256?: string
          created_at?: string
          id?: string
          is_stable?: boolean
          release_notes?: string | null
          storage_path?: string
          version?: string
        }
        Relationships: []
      }
      firmware_versions: {
        Row: {
          active: boolean | null
          checksum: string | null
          created_at: string | null
          download_path: string
          id: string
          is_default: boolean | null
          release_notes: string | null
          user_id: string
          version: string
        }
        Insert: {
          active?: boolean | null
          checksum?: string | null
          created_at?: string | null
          download_path: string
          id?: string
          is_default?: boolean | null
          release_notes?: string | null
          user_id: string
          version: string
        }
        Update: {
          active?: boolean | null
          checksum?: string | null
          created_at?: string | null
          download_path?: string
          id?: string
          is_default?: boolean | null
          release_notes?: string | null
          user_id?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "firmware_versions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          id: string
          provider: string
          provider_user_id: string | null
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          id?: string
          provider: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          provider?: string
          provider_user_id?: string | null
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      orders: {
        Row: {
          amount_cents: number | null
          created_at: string | null
          id: string
          status: string | null
          stripe_charge_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string | null
          id?: string
          status?: string | null
          stripe_charge_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string | null
          id?: string
          status?: string | null
          stripe_charge_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_entries: {
        Row: {
          created_at: string
          duration_seconds: number
          id: string
          layout_id: string
          playlist_id: string
          position: number
          updated_at: string
          widget_config: Json
          widget_id: string
        }
        Insert: {
          created_at?: string
          duration_seconds?: number
          id?: string
          layout_id?: string
          playlist_id: string
          position: number
          updated_at?: string
          widget_config?: Json
          widget_id: string
        }
        Update: {
          created_at?: string
          duration_seconds?: number
          id?: string
          layout_id?: string
          playlist_id?: string
          position?: number
          updated_at?: string
          widget_config?: Json
          widget_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_entries_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "device_summary"
            referencedColumns: ["playlist_id"]
          },
          {
            foreignKeyName: "playlist_entries_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_entries_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "widget_registry"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          device_id: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "device_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlists_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: true
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      render_cache: {
        Row: {
          checksum: string
          color_mode: string
          device_id: string
          expires_at: string
          height_px: number
          id: string
          playlist_entry_id: string
          rendered_at: string
          storage_path: string
          width_px: number
        }
        Insert: {
          checksum: string
          color_mode: string
          device_id: string
          expires_at: string
          height_px: number
          id?: string
          playlist_entry_id: string
          rendered_at?: string
          storage_path: string
          width_px: number
        }
        Update: {
          checksum?: string
          color_mode?: string
          device_id?: string
          expires_at?: string
          height_px?: number
          id?: string
          playlist_entry_id?: string
          rendered_at?: string
          storage_path?: string
          width_px?: number
        }
        Relationships: [
          {
            foreignKeyName: "render_cache_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "device_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_cache_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "render_cache_playlist_entry_id_fkey"
            columns: ["playlist_entry_id"]
            isOneToOne: false
            referencedRelation: "playlist_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_profiles: {
        Row: {
          color_mode: string
          created_at: string
          display_name: string
          dpi_approx: number
          height_px: number
          id: string
          is_builtin: boolean
          orientation: string
          partial_refresh: boolean
          physical_height_mm: number
          physical_width_mm: number
          slug: string
          width_px: number
        }
        Insert: {
          color_mode: string
          created_at?: string
          display_name: string
          dpi_approx: number
          height_px: number
          id?: string
          is_builtin?: boolean
          orientation?: string
          partial_refresh?: boolean
          physical_height_mm: number
          physical_width_mm: number
          slug: string
          width_px: number
        }
        Update: {
          color_mode?: string
          created_at?: string
          display_name?: string
          dpi_approx?: number
          height_px?: number
          id?: string
          is_builtin?: boolean
          orientation?: string
          partial_refresh?: boolean
          physical_height_mm?: number
          physical_width_mm?: number
          slug?: string
          width_px?: number
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          created_at: string
          default_price_area: string
          default_timezone: string
          energy_price_location: string | null
          layout: Json | null
          monta_fields: Json | null
          news_language: string | null
          refresh_interval_minutes: number | null
          show_air_quality: boolean | null
          show_energy_price: boolean | null
          show_monta: boolean | null
          show_news: boolean | null
          show_notion: boolean | null
          show_weather: boolean | null
          show_zaptec: boolean | null
          updated_at: string
          user_id: string
          weather_location: string | null
          zaptec_fields: Json | null
        }
        Insert: {
          created_at?: string
          default_price_area?: string
          default_timezone?: string
          energy_price_location?: string | null
          layout?: Json | null
          monta_fields?: Json | null
          news_language?: string | null
          refresh_interval_minutes?: number | null
          show_air_quality?: boolean | null
          show_energy_price?: boolean | null
          show_monta?: boolean | null
          show_news?: boolean | null
          show_notion?: boolean | null
          show_weather?: boolean | null
          show_zaptec?: boolean | null
          updated_at?: string
          user_id: string
          weather_location?: string | null
          zaptec_fields?: Json | null
        }
        Update: {
          created_at?: string
          default_price_area?: string
          default_timezone?: string
          energy_price_location?: string | null
          layout?: Json | null
          monta_fields?: Json | null
          news_language?: string | null
          refresh_interval_minutes?: number | null
          show_air_quality?: boolean | null
          show_energy_price?: boolean | null
          show_monta?: boolean | null
          show_news?: boolean | null
          show_notion?: boolean | null
          show_weather?: boolean | null
          show_zaptec?: boolean | null
          updated_at?: string
          user_id?: string
          weather_location?: string | null
          zaptec_fields?: Json | null
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          display_name: string | null
          email: string
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          email: string
          id?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          email?: string
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      widget_registry: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          is_active: boolean
          name: string
          requires_oauth: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description: string
          id: string
          is_active?: boolean
          name: string
          requires_oauth?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          name?: string
          requires_oauth?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      device_summary: {
        Row: {
          color_mode: string | null
          firmware_version: string | null
          height_px: number | null
          id: string | null
          is_active: boolean | null
          last_seen_at: string | null
          name: string | null
          playlist_entry_count: number | null
          playlist_id: string | null
          playlist_total_duration_seconds: number | null
          profile_name: string | null
          profile_slug: string | null
          user_id: string | null
          width_px: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      delete_oauth_connection: {
        Args: { p_provider: string; p_user_id: string }
        Returns: undefined
      }
      get_oauth_connection: {
        Args: { p_provider: string; p_user_id: string }
        Returns: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          provider: string
          provider_account_id: string
          refresh_token: string
          updated_at: string
          user_id: string
        }[]
      }
      upsert_oauth_connection: {
        Args: {
          p_access_token: string
          p_expires_at: string
          p_provider: string
          p_provider_account_id: string
          p_refresh_token: string
          p_user_id: string
        }
        Returns: undefined
      }
      upsert_user_preferences: {
        Args: {
          p_energy_price_location?: string
          p_layout?: Json
          p_monta_fields?: Json
          p_news_language?: string
          p_refresh_interval_minutes?: number
          p_show_air_quality?: boolean
          p_show_calendar?: boolean
          p_show_energy_price?: boolean
          p_show_monta?: boolean
          p_show_news?: boolean
          p_show_weather?: boolean
          p_show_zaptec?: boolean
          p_user_id: string
          p_weather_location?: string
          p_zaptec_fields?: Json
        }
        Returns: {
          created_at: string
          default_price_area: string
          default_timezone: string
          energy_price_location: string | null
          layout: Json | null
          monta_fields: Json | null
          news_language: string | null
          refresh_interval_minutes: number | null
          show_air_quality: boolean | null
          show_energy_price: boolean | null
          show_monta: boolean | null
          show_news: boolean | null
          show_notion: boolean | null
          show_weather: boolean | null
          show_zaptec: boolean | null
          updated_at: string
          user_id: string
          weather_location: string | null
          zaptec_fields: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "user_preferences"
          isOneToOne: false
          isSetofReturn: true
        }
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
