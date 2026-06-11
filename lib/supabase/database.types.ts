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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      admin_gbp_token: {
        Row: {
          access_token: string
          email: string | null
          expiry_date: number
          id: number
          refresh_token: string
          updated_at: string
        }
        Insert: {
          access_token: string
          email?: string | null
          expiry_date: number
          id: number
          refresh_token: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          email?: string | null
          expiry_date?: number
          id?: number
          refresh_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_google_token: {
        Row: {
          access_token: string
          created_at: string | null
          email: string | null
          expiry_date: number
          id: number
          refresh_token: string
          updated_at: string | null
        }
        Insert: {
          access_token: string
          created_at?: string | null
          email?: string | null
          expiry_date: number
          id?: number
          refresh_token: string
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          created_at?: string | null
          email?: string | null
          expiry_date?: number
          id?: number
          refresh_token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      api_cache: {
        Row: {
          created_at: string
          expires_at: string
          key: string
          payload: Json
        }
        Insert: {
          created_at?: string
          expires_at: string
          key: string
          payload: Json
        }
        Update: {
          created_at?: string
          expires_at?: string
          key?: string
          payload?: Json
        }
        Relationships: []
      }
      ask_lvl3_conversations: {
        Row: {
          client_id: string
          created_at: string
          id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_lvl3_conversations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      ask_lvl3_messages: {
        Row: {
          artifacts: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          artifacts?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          artifacts?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ask_lvl3_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "ask_lvl3_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          ai_summary: string | null
          ai_summary_updated_at: string | null
          analytics_summary: string | null
          analytics_summary_updated_at: string | null
          brand_context: string | null
          created_at: string
          ga4_property_id: string | null
          google_sheet_id: string | null
          gsc_site_url: string | null
          hero_image_url: string | null
          id: string
          logo_url: string | null
          looker_embed_url: string | null
          name: string
          sheet_column_map: Json | null
          sheet_header_row: number | null
          slug: string
          snapshot_insights: Json | null
          snapshot_insights_draft: Json | null
        }
        Insert: {
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          analytics_summary?: string | null
          analytics_summary_updated_at?: string | null
          brand_context?: string | null
          created_at?: string
          ga4_property_id?: string | null
          google_sheet_id?: string | null
          gsc_site_url?: string | null
          hero_image_url?: string | null
          id?: string
          logo_url?: string | null
          looker_embed_url?: string | null
          name: string
          sheet_column_map?: Json | null
          sheet_header_row?: number | null
          slug: string
          snapshot_insights?: Json | null
          snapshot_insights_draft?: Json | null
        }
        Update: {
          ai_summary?: string | null
          ai_summary_updated_at?: string | null
          analytics_summary?: string | null
          analytics_summary_updated_at?: string | null
          brand_context?: string | null
          created_at?: string
          ga4_property_id?: string | null
          google_sheet_id?: string | null
          gsc_site_url?: string | null
          hero_image_url?: string | null
          id?: string
          logo_url?: string | null
          looker_embed_url?: string | null
          name?: string
          sheet_column_map?: Json | null
          sheet_header_row?: number | null
          slug?: string
          snapshot_insights?: Json | null
          snapshot_insights_draft?: Json | null
        }
        Relationships: []
      }
      comments: {
        Row: {
          body: string
          created_at: string
          deliverable_id: string
          id: string
          parent_id: string | null
          resolved: boolean
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          deliverable_id: string
          id?: string
          parent_id?: string | null
          resolved?: boolean
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deliverable_id?: string
          id?: string
          parent_id?: string | null
          resolved?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_deliverable_id_fkey"
            columns: ["deliverable_id"]
            isOneToOne: false
            referencedRelation: "deliverables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      deliverables: {
        Row: {
          client_id: string
          created_at: string
          file_type: Database["public"]["Enums"]["file_type"]
          file_url: string | null
          id: string
          title: string
          viewed_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          file_type: Database["public"]["Enums"]["file_type"]
          file_url?: string | null
          id?: string
          title: string
          viewed_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          file_type?: Database["public"]["Enums"]["file_type"]
          file_url?: string | null
          id?: string
          title?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliverables_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string
          category: string
          created_at: string
          id: string
          target_client_id: string | null
          title: string
        }
        Insert: {
          body: string
          category: string
          created_at?: string
          id?: string
          target_client_id?: string | null
          title: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          id?: string
          target_client_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_target_client_id_fkey"
            columns: ["target_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      semrush_reports: {
        Row: {
          client_domain: string
          client_id: string
          client_keyword_count: number
          competitors: string[]
          created_at: string
          database: string
          filters: Json
          id: string
          keyword_count: number
          matrix_data: Json
          page_section: string
          relevance_scores: Json | null
        }
        Insert: {
          client_domain: string
          client_id: string
          client_keyword_count?: number
          competitors: string[]
          created_at?: string
          database?: string
          filters?: Json
          id?: string
          keyword_count?: number
          matrix_data: Json
          page_section?: string
          relevance_scores?: Json | null
        }
        Update: {
          client_domain?: string
          client_id?: string
          client_keyword_count?: number
          competitors?: string[]
          created_at?: string
          database?: string
          filters?: Json
          id?: string
          keyword_count?: number
          matrix_data?: Json
          page_section?: string
          relevance_scores?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "semrush_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_content_engine_runs: {
        Row: {
          brand_context: string | null
          client_id: string
          completed_at: string | null
          completed_count: number
          created_at: string
          error: string | null
          id: string
          mode: string
          status: string
          topic_count: number
          updated_at: string
        }
        Insert: {
          brand_context?: string | null
          client_id: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          error?: string | null
          id?: string
          mode: string
          status?: string
          topic_count?: number
          updated_at?: string
        }
        Update: {
          brand_context?: string | null
          client_id?: string
          completed_at?: string | null
          completed_count?: number
          created_at?: string
          error?: string | null
          id?: string
          mode?: string
          status?: string
          topic_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_content_engine_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_content_engine_topics: {
        Row: {
          angle: string | null
          brief: Json | null
          brief_json_storage_path: string | null
          created_at: string
          data_availability: Json | null
          differentiation_angle: string | null
          docx_storage_path: string | null
          draft: string | null
          draft_review: Json | null
          error: string | null
          existing_url: string | null
          funnel_stage: string | null
          geo_notes: string | null
          id: string
          internal_linking: string | null
          keyword_plan: Json | null
          pillar: string | null
          primary_intent: string | null
          revised_draft: string | null
          run_id: string
          seed_keywords: Json | null
          status: string
          summary: string | null
          target_audience: string | null
          title: string
          updated_at: string
          warnings: string[] | null
          word_count: number | null
        }
        Insert: {
          angle?: string | null
          brief?: Json | null
          brief_json_storage_path?: string | null
          created_at?: string
          data_availability?: Json | null
          differentiation_angle?: string | null
          docx_storage_path?: string | null
          draft?: string | null
          draft_review?: Json | null
          error?: string | null
          existing_url?: string | null
          funnel_stage?: string | null
          geo_notes?: string | null
          id?: string
          internal_linking?: string | null
          keyword_plan?: Json | null
          pillar?: string | null
          primary_intent?: string | null
          revised_draft?: string | null
          run_id: string
          seed_keywords?: Json | null
          status?: string
          summary?: string | null
          target_audience?: string | null
          title: string
          updated_at?: string
          warnings?: string[] | null
          word_count?: number | null
        }
        Update: {
          angle?: string | null
          brief?: Json | null
          brief_json_storage_path?: string | null
          created_at?: string
          data_availability?: Json | null
          differentiation_angle?: string | null
          docx_storage_path?: string | null
          draft?: string | null
          draft_review?: Json | null
          error?: string | null
          existing_url?: string | null
          funnel_stage?: string | null
          geo_notes?: string | null
          id?: string
          internal_linking?: string | null
          keyword_plan?: Json | null
          pillar?: string | null
          primary_intent?: string | null
          revised_draft?: string | null
          run_id?: string
          seed_keywords?: Json | null
          status?: string
          summary?: string | null
          target_audience?: string | null
          title?: string
          updated_at?: string
          warnings?: string[] | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "seo_content_engine_topics_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "seo_content_engine_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          cta_url: string | null
          description: string
          id: string
          target_client_ids: string[]
          title: string
        }
        Insert: {
          created_at?: string
          cta_url?: string | null
          description: string
          id?: string
          target_client_ids?: string[]
          title: string
        }
        Update: {
          created_at?: string
          cta_url?: string | null
          description?: string
          id?: string
          target_client_ids?: string[]
          title?: string
        }
        Relationships: []
      }
      tool_runs: {
        Row: {
          artifact_path: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          input: Json
          output: Json | null
          started_at: string | null
          status: string
          tool_slug: string
          user_id: string | null
        }
        Insert: {
          artifact_path?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_slug: string
          user_id?: string | null
        }
        Update: {
          artifact_path?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          input?: Json
          output?: Json | null
          started_at?: string | null
          status?: string
          tool_slug?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tool_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_client_access: {
        Row: {
          client_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_client_access_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_client_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          client_id: string | null
          created_at: string
          email: string
          id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          email: string
          id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          client_id?: string | null
          created_at?: string
          email?: string
          id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_tool_data: { Args: never; Returns: undefined }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
    }
    Enums: {
      file_type: "pdf" | "slides" | "sheets" | "link"
      user_role: "admin" | "client" | "member"
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
    Enums: {
      file_type: ["pdf", "slides", "sheets", "link"],
      user_role: ["admin", "client", "member"],
    },
  },
} as const
