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
      notifications: {
        Row: {
          id: string
          user_id: string
          org_id: string
          type: string
          activity_id: string | null
          actor_id: string | null
          data: Json
          read_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          org_id: string
          type: string
          activity_id?: string | null
          actor_id?: string | null
          data?: Json
          read_at?: string | null
          created_at?: string
        }
        Update: {
          read_at?: string | null
        }
        Relationships: [
          { foreignKeyName: "notifications_actor_id_fkey"; columns: ["actor_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] },
          { foreignKeyName: "notifications_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] }
        ]
      }
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
      activity_field_history: {
        Row: {
          id: string
          activity_id: string
          changed_by: string
          field_name: string
          old_value: string | null
          new_value: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          activity_id: string
          changed_by: string
          field_name: string
          old_value?: string | null
          new_value?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          activity_id?: string
          changed_by?: string
          field_name?: string
          old_value?: string | null
          new_value?: string | null
          changed_at?: string
        }
        Relationships: [
          { foreignKeyName: "activity_field_history_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] },
          { foreignKeyName: "activity_field_history_changed_by_fkey"; columns: ["changed_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
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
      activity_assignees: {
        Row: {
          activity_id: string
          user_id: string
          assigned_at: string
        }
        Insert: {
          activity_id: string
          user_id: string
          assigned_at?: string
        }
        Update: {
          activity_id?: string
          user_id?: string
          assigned_at?: string
        }
        Relationships: [
          { foreignKeyName: "activity_assignees_activity_id_fkey"; columns: ["activity_id"]; isOneToOne: false; referencedRelation: "activities"; referencedColumns: ["id"] },
          { foreignKeyName: "activity_assignees_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
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
          archived: boolean
          archived_at: string | null
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
          recurrence: string | null
          recurrence_remaining: number | null
          recurrence_reset_status: Database["public"]["Enums"]["activity_status"] | null
          drive_folder_id: string | null
          drive_path: string | null
          preview_url: string | null
          review_status: string | null
          review_errors: Json | null
          review_target: string | null
          review_at: string | null
          review_kind: string | null
          id: string
          priority: Database["public"]["Enums"]["activity_priority"]
          sort_order: number
          status: Database["public"]["Enums"]["activity_status"]
          title: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          archived?: boolean
          archived_at?: string | null
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
          recurrence?: string | null
          recurrence_remaining?: number | null
          recurrence_reset_status?: Database["public"]["Enums"]["activity_status"] | null
          drive_folder_id?: string | null
          drive_path?: string | null
          preview_url?: string | null
          review_status?: string | null
          review_errors?: Json | null
          review_target?: string | null
          review_at?: string | null
          review_kind?: string | null
          id?: string
          priority?: Database["public"]["Enums"]["activity_priority"]
          sort_order?: number
          status?: Database["public"]["Enums"]["activity_status"]
          title: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          archived?: boolean
          archived_at?: string | null
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
          recurrence?: string | null
          recurrence_remaining?: number | null
          recurrence_reset_status?: Database["public"]["Enums"]["activity_status"] | null
          drive_folder_id?: string | null
          drive_path?: string | null
          preview_url?: string | null
          review_status?: string | null
          review_errors?: Json | null
          review_target?: string | null
          review_at?: string | null
          review_kind?: string | null
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
          archived: boolean
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          updated_at: string
          workspace_id: string
          drive_folder_id: string | null
        }
        Insert: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          updated_at?: string
          workspace_id: string
          drive_folder_id?: string | null
        }
        Update: {
          archived?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          updated_at?: string
          workspace_id?: string
          drive_folder_id?: string | null
        }
        Relationships: [
          { foreignKeyName: "campaigns_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] }
        ]
      }
      org_invite_links: {
        Row: {
          id: string
          org_id: string
          token: string
          role: Database["public"]["Enums"]["member_role"]
          is_active: boolean
          created_by: string | null
          use_count: number
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          token?: string
          role?: Database["public"]["Enums"]["member_role"]
          is_active?: boolean
          created_by?: string | null
          use_count?: number
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          token?: string
          role?: Database["public"]["Enums"]["member_role"]
          is_active?: boolean
          created_by?: string | null
          use_count?: number
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "org_invite_links_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }
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
      org_positions: {
        Row: {
          id: string
          org_id: string
          name: string
          color: string
          allowed_statuses: Database["public"]["Enums"]["activity_status"][]
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          name: string
          color?: string
          allowed_statuses?: Database["public"]["Enums"]["activity_status"][]
          created_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          name?: string
          color?: string
          allowed_statuses?: Database["public"]["Enums"]["activity_status"][]
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "org_positions_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] }
        ]
      }
      organization_members: {
        Row: {
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          position_id: string | null
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          position_id?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          position_id?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          { foreignKeyName: "organization_members_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "organization_members_position_id_fkey"; columns: ["position_id"]; isOneToOne: false; referencedRelation: "org_positions"; referencedColumns: ["id"] },
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
          drive_mac_user: string | null
          drive_google_email: string | null
          drive_lang: string | null
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
          drive_mac_user?: string | null
          drive_google_email?: string | null
          drive_lang?: string | null
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
          drive_mac_user?: string | null
          drive_google_email?: string | null
          drive_lang?: string | null
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
      visual_boards: {
        Row: {
          id: string
          org_id: string
          workspace_id: string | null
          title: string
          kind: string
          data: Json
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workspace_id?: string | null
          title?: string
          kind?: string
          data?: Json
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          workspace_id?: string | null
          title?: string
          kind?: string
          data?: Json
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "visual_boards_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "visual_boards_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
          { foreignKeyName: "visual_boards_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      documents: {
        Row: {
          id: string
          org_id: string
          workspace_id: string | null
          parent_id: string | null
          title: string
          content: Json
          visibility: string
          created_by: string
          is_folder: boolean
          archived: boolean
          briefing_workspace_id: string | null
          briefing_campaign_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          org_id: string
          workspace_id?: string | null
          parent_id?: string | null
          title?: string
          content?: Json
          visibility?: string
          created_by: string
          is_folder?: boolean
          archived?: boolean
          briefing_workspace_id?: string | null
          briefing_campaign_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          org_id?: string
          workspace_id?: string | null
          parent_id?: string | null
          title?: string
          content?: Json
          visibility?: string
          created_by?: string
          is_folder?: boolean
          archived?: boolean
          briefing_workspace_id?: string | null
          briefing_campaign_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: "documents_org_id_fkey"; columns: ["org_id"]; isOneToOne: false; referencedRelation: "organizations"; referencedColumns: ["id"] },
          { foreignKeyName: "documents_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
          { foreignKeyName: "documents_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
      document_members: {
        Row: {
          document_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          document_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          document_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: [
          { foreignKeyName: "document_members_document_id_fkey"; columns: ["document_id"]; isOneToOne: false; referencedRelation: "documents"; referencedColumns: ["id"] },
          { foreignKeyName: "document_members_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "profiles"; referencedColumns: ["id"] }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      update_activity_field: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_field: string
          p_value: string | null
        }
        Returns: undefined
      }
      toggle_activity_assignee: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_assignee_id: string
        }
        Returns: boolean
      }
      set_activity_archived: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_archived: boolean
        }
        Returns: undefined
      }
      set_workspace_archived: {
        Args: { p_user_id: string; p_workspace_id: string; p_archived: boolean }
        Returns: undefined
      }
      set_campaign_archived: {
        Args: { p_user_id: string; p_campaign_id: string; p_archived: boolean }
        Returns: undefined
      }
      create_document: {
        Args: { p_user_id: string; p_org_id: string; p_workspace_id: string | null; p_parent_id?: string | null }
        Returns: string
      }
      create_folder: {
        Args: { p_user_id: string; p_org_id: string; p_workspace_id: string | null; p_name: string }
        Returns: string
      }
      move_document: {
        Args: { p_user_id: string; p_doc_id: string; p_parent_id: string | null; p_workspace_id: string | null }
        Returns: undefined
      }
      update_document_content: {
        Args: { p_user_id: string; p_doc_id: string; p_content: Json }
        Returns: undefined
      }
      update_document_title: {
        Args: { p_user_id: string; p_doc_id: string; p_title: string }
        Returns: undefined
      }
      set_document_visibility: {
        Args: { p_user_id: string; p_doc_id: string; p_visibility: string; p_member_ids: string[] }
        Returns: undefined
      }
      delete_document: {
        Args: { p_user_id: string; p_doc_id: string }
        Returns: undefined
      }
      set_document_workspace: {
        Args: { p_user_id: string; p_doc_id: string; p_workspace_id: string | null }
        Returns: undefined
      }
      set_campaign_drive: {
        Args: { p_user_id: string; p_campaign_id: string; p_drive_folder_id: string | null }
        Returns: undefined
      }
      set_activity_drive: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_drive_folder_id: string | null
          p_drive_path: string | null
          p_drive_folder_url: string | null
          p_redacao_url: string | null
          p_finalizacao_url: string | null
          p_preview_url: string | null
        }
        Returns: undefined
      }
      set_redacao_review: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_status: string | null
          p_errors: Json | null
          p_target: string | null
        }
        Returns: undefined
      }
      search_activities: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_query: string
          p_include_archived?: boolean
        }
        Returns: {
          id: string
          title: string
          status: string
          archived: boolean
          campaign_id: string
          campaign_name: string
          workspace_id: string
          workspace_name: string
        }[]
      }
      is_org_member: {
        Args: { p_org_id: string }
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
      update_workspace: {
        Args: { p_user_id: string; p_workspace_id: string; p_name: string; p_description: string; p_color: string }
        Returns: void
      }
      delete_workspace: {
        Args: { p_user_id: string; p_workspace_id: string }
        Returns: void
      }
      update_campaign: {
        Args: { p_user_id: string; p_campaign_id: string; p_name: string; p_description: string; p_start_date: string | null; p_end_date: string | null }
        Returns: void
      }
      delete_campaign: {
        Args: { p_user_id: string; p_campaign_id: string }
        Returns: void
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
      add_comment_with_mentions: {
        Args: {
          p_user_id: string
          p_activity_id: string
          p_content: string
          p_mention_ids?: string[]
          p_mention_all?: boolean
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
      create_org_position: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_name: string
          p_color: string
          p_allowed_statuses: Database["public"]["Enums"]["activity_status"][]
        }
        Returns: string
      }
      update_org_position: {
        Args: {
          p_user_id: string
          p_position_id: string
          p_name: string
          p_color: string
          p_allowed_statuses: Database["public"]["Enums"]["activity_status"][]
        }
        Returns: void
      }
      delete_org_position: {
        Args: {
          p_user_id: string
          p_position_id: string
        }
        Returns: void
      }
      update_member: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_member_id: string
          p_position_id: string | null
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: void
      }
      remove_member: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_member_id: string
        }
        Returns: void
      }
      seed_default_positions: {
        Args: {
          p_org_id: string
        }
        Returns: void
      }
      upsert_invite_link: {
        Args: {
          p_user_id: string
          p_org_id: string
          p_role: Database["public"]["Enums"]["member_role"]
        }
        Returns: string
      }
      deactivate_invite_link: {
        Args: {
          p_user_id: string
          p_org_id: string
        }
        Returns: undefined
      }
      accept_invite_link: {
        Args: {
          p_user_id: string
          p_token: string
        }
        Returns: string
      }
      update_activity_dates: {
        Args: { p_user_id: string; p_activity_id: string; p_start_date: string | null; p_due_date: string | null }
        Returns: void
      }
      get_invite_info: {
        Args: { p_token: string }
        Returns: {
          token: string
          is_active: boolean
          role: Database["public"]["Enums"]["member_role"]
          org_name: string
          org_slug: string
        }[]
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
