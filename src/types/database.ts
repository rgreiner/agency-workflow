export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      activity_comments: {
        Row: {
          activity_id: string
          attachments: Json
          content: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          attachments?: Json
          content: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          attachments?: Json
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "activity_comments_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] },
          { foreignKeyName: "activity_comments_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      activity_history: {
        Row: {
          activity_id: string
          changed_at: string
          changed_by: string | null
          comment: string | null
          from_status: Database["public"]["Enums"]["activity_status"] | null
          id: string
          to_status: Database["public"]["Enums"]["activity_status"]
        }
        Insert: {
          activity_id: string
          changed_at?: string
          changed_by?: string | null
          comment?: string | null
          from_status?: Database["public"]["Enums"]["activity_status"] | null
          id?: string
          to_status: Database["public"]["Enums"]["activity_status"]
        }
        Update: {
          activity_id?: string
          changed_at?: string
          changed_by?: string | null
          comment?: string | null
          from_status?: Database["public"]["Enums"]["activity_status"] | null
          id?: string
          to_status?: Database["public"]["Enums"]["activity_status"]
        }
        Relationships: [
          { foreignKeyName: "activity_history_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] }
        ]
      }
      activity_status_assignees: {
        Row: {
          activity_id: string
          id: string
          status: Database["public"]["Enums"]["activity_status"]
          user_id: string
        }
        Insert: {
          activity_id: string
          id?: string
          status: Database["public"]["Enums"]["activity_status"]
          user_id: string
        }
        Update: {
          activity_id?: string
          id?: string
          status?: Database["public"]["Enums"]["activity_status"]
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "activity_status_assignees_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] },
          { foreignKeyName: "activity_status_assignees_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      activities: {
        Row: {
          campaign_id: string
          complexity: Database["public"]["Enums"]["activity_complexity"]
          created_at: string
          created_by: string | null
          description: string | null
          start_date: string | null
          due_date: string | null
          estimated_hours: number | null
          drive_folder_url: string | null
          redacao_url: string | null
          layout_url: string | null
          finalizacao_url: string | null
          orcamento: string | null
          id: string
          priority: Database["public"]["Enums"]["activity_priority"]
          sort_order: number
          status: Database["public"]["Enums"]["activity_status"]
          title: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          complexity?: Database["public"]["Enums"]["activity_complexity"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          start_date?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          drive_folder_url?: string | null
          redacao_url?: string | null
          layout_url?: string | null
          finalizacao_url?: string | null
          orcamento?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["activity_priority"]
          sort_order?: number
          status?: Database["public"]["Enums"]["activity_status"]
          title: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          complexity?: Database["public"]["Enums"]["activity_complexity"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          start_date?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          drive_folder_url?: string | null
          redacao_url?: string | null
          layout_url?: string | null
          finalizacao_url?: string | null
          orcamento?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["activity_priority"]
          sort_order?: number
          status?: Database["public"]["Enums"]["activity_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "activities_campaign_id_fkey"; columns: ["campaign_id"]; isOneToOne: false; referencedRelation: "campaigns"; referencedColumns: ["id"] }
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          { foreignKeyName: "campaigns_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] }
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          token?: string
        }
        Relationships: [
          { foreignKeyName: "invitations_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }
        ]
      }
      organization_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "organization_members_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "organization_members_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          max_members: number
          name: string
          plan: Database["public"]["Enums"]["org_plan"]
          slug: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          company_type: string | null
          company_size: string | null
          segment: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          max_members?: number
          name: string
          plan?: Database["public"]["Enums"]["org_plan"]
          slug: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          company_type?: string | null
          company_size?: string | null
          segment?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          max_members?: number
          name?: string
          plan?: Database["public"]["Enums"]["org_plan"]
          slug?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          company_type?: string | null
          company_size?: string | null
          segment?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          role_title: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          role_title?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          role_title?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          archived: boolean
          color: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          archived?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          archived?: boolean
          color?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "workspaces_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_org_member: {
        Args: { org: string }
        Returns: boolean
      }
      org_member_role: {
        Args: { org: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      create_org_for_user: {
        Args: {
          p_user_id: string
          p_name: string
          p_slug: string
          p_type: string
          p_size: string
          p_segment: string
        }
        Returns: string
      }
      create_workspace: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_name: string
          p_description: string
          p_color: string
        }
        Returns: string
      }
      create_campaign: {
        Args: {
          p_user_id: string
          p_workspace_id: string
          p_name: string
          p_description: string
          p_start_date: string | null
          p_end_date: string | null
        }
        Returns: string
      }
      create_activity: {
        Args: {
          p_user_id: string
          p_campaign_id: string
          p_title: string
          p_description: string
          p_status: string
          p_priority: string
          p_complexity: string
          p_due_date: string | null
          p_estimated_hours: number | null
          p_start_date?: string | null
        }
        Returns: string
      }
      update_activity_status: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_new_status: string
          p_comment: string
        }
        Returns: void
      }
      add_activity_comment: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_content: string
        }
        Returns: string
      }
      update_activity_links: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_drive_folder_url: string | null
          p_redacao_url: string | null
          p_layout_url: string | null
          p_finalizacao_url: string | null
          p_orcamento: string | null
        }
        Returns: void
      }
    }
    Enums: {
      activity_complexity: "simple" | "medium" | "complex"
      activity_priority: "low" | "medium" | "high" | "urgent"
      activity_status:
        | "briefing"
        | "pendente_cliente"
        | "planejamento"
        | "insight"
        | "redacao"
        | "design"
        | "edicao"
        | "finalizacao"
        | "revisao_interna"
        | "validacao_atendimento"
        | "orcamento"
        | "producao_fornecedores"
        | "producao_audiovisual"
        | "validacao_midia"
        | "midia"
        | "social"
        | "aprovacao_cliente"
        | "implantacao_digital"
        | "implantacao_off"
        | "concluido"
      member_role: "owner" | "admin" | "manager" | "member" | "viewer"
      org_plan: "free" | "starter" | "pro" | "enterprise"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never
