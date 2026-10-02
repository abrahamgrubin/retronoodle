/**
 * Hand-authored to match `supabase/migrations` (RN-002) until a local Supabase stack is
 * available to run `supabase gen types typescript --local` for real. Keep this file's shape
 * identical to that command's output (same `Database` interface, same per-table
 * Row/Insert/Update/Relationships) so swapping in the generated file later is a no-op for
 * every import site.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          email: string;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          email: string;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          email?: string;
          avatar_url?: string | null;
          timezone?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      teams: {
        Row: {
          id: string;
          name: string;
          created_by: string;
          retro_cadence_days: number;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          created_by: string;
          retro_cadence_days?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_by?: string;
          retro_cadence_days?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      team_members: {
        Row: {
          team_id: string;
          user_id: string;
          role: Database['public']['Enums']['team_role'];
          created_at: string;
        };
        Insert: {
          team_id: string;
          user_id: string;
          role?: Database['public']['Enums']['team_role'];
          created_at?: string;
        };
        Update: {
          team_id?: string;
          user_id?: string;
          role?: Database['public']['Enums']['team_role'];
          created_at?: string;
        };
        Relationships: [];
      };
      templates: {
        Row: {
          id: string;
          team_id: string | null;
          source: string;
          name: string;
          columns: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          team_id?: string | null;
          source?: string;
          name: string;
          columns: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string | null;
          source?: string;
          name?: string;
          columns?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      retros: {
        Row: {
          id: string;
          team_id: string;
          facilitator_id: string;
          template_id: string;
          name: string;
          phase: Database['public']['Enums']['retro_phase'];
          join_code_hash: string;
          cards_revealed: boolean;
          vote_budget: number;
          phase_deadline: string | null;
          phase_remaining_ms: number | null;
          next_retro_at: string | null;
          is_demo: boolean;
          closed_with_override: boolean;
          template_source: string;
          created_at: string;
          closed_at: string | null;
        };
        Insert: {
          id: string;
          team_id: string;
          facilitator_id: string;
          template_id: string;
          name: string;
          phase?: Database['public']['Enums']['retro_phase'];
          join_code_hash: string;
          cards_revealed?: boolean;
          vote_budget?: number;
          phase_deadline?: string | null;
          phase_remaining_ms?: number | null;
          next_retro_at?: string | null;
          is_demo?: boolean;
          closed_with_override?: boolean;
          template_source: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          team_id?: string;
          facilitator_id?: string;
          template_id?: string;
          name?: string;
          phase?: Database['public']['Enums']['retro_phase'];
          join_code_hash?: string;
          cards_revealed?: boolean;
          vote_budget?: number;
          phase_deadline?: string | null;
          phase_remaining_ms?: number | null;
          next_retro_at?: string | null;
          is_demo?: boolean;
          closed_with_override?: boolean;
          template_source?: string;
          created_at?: string;
          closed_at?: string | null;
        };
        Relationships: [];
      };
      retro_columns: {
        Row: {
          id: string;
          retro_id: string;
          title: string;
          prompt: string | null;
          color: string;
          kind: string;
          position: number;
          created_at: string;
        };
        Insert: {
          id: string;
          retro_id: string;
          title: string;
          prompt?: string | null;
          color: string;
          kind?: string;
          position: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          retro_id?: string;
          title?: string;
          prompt?: string | null;
          color?: string;
          kind?: string;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      topics: {
        Row: {
          id: string;
          retro_id: string;
          column_id: string;
          name: string;
          discussion_order: string | null;
          vote_count: number;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          ai_group_summary_title: string | null;
          ai_group_summary: string | null;
          ai_discussion_questions: string[] | null;
        };
        Insert: {
          id: string;
          retro_id: string;
          column_id: string;
          name: string;
          discussion_order?: string | null;
          vote_count?: number;
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
          ai_group_summary_title?: string | null;
          ai_group_summary?: string | null;
          ai_discussion_questions?: string[] | null;
        };
        Update: {
          id?: string;
          retro_id?: string;
          column_id?: string;
          name?: string;
          discussion_order?: string | null;
          vote_count?: number;
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
          ai_group_summary_title?: string | null;
          ai_group_summary?: string | null;
          ai_discussion_questions?: string[] | null;
        };
        Relationships: [];
      };
      cards: {
        Row: {
          id: string;
          retro_id: string;
          column_id: string;
          author_id: string;
          topic_id: string | null;
          body: string;
          position: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          retro_id: string;
          column_id: string;
          author_id: string;
          topic_id?: string | null;
          body: string;
          position: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          retro_id?: string;
          column_id?: string;
          author_id?: string;
          topic_id?: string | null;
          body?: string;
          position?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      card_reactions: {
        Row: {
          card_id: string;
          user_id: string;
          emoji: string;
          created_at: string;
        };
        Insert: {
          card_id: string;
          user_id: string;
          emoji: string;
          created_at?: string;
        };
        Update: {
          card_id?: string;
          user_id?: string;
          emoji?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      votes: {
        Row: {
          id: string;
          retro_id: string;
          topic_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          retro_id: string;
          topic_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          retro_id?: string;
          topic_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      retro_participants: {
        Row: {
          retro_id: string;
          user_id: string;
          joined_at: string;
        };
        Insert: {
          retro_id: string;
          user_id: string;
          joined_at?: string;
        };
        Update: {
          retro_id?: string;
          user_id?: string;
          joined_at?: string;
        };
        Relationships: [];
      };
      group_suggestions: {
        Row: {
          id: string;
          retro_id: string;
          name: string;
          card_ids: string[];
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          retro_id: string;
          name: string;
          card_ids: string[];
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          retro_id?: string;
          name?: string;
          card_ids?: string[];
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      action_items: {
        Row: {
          id: string;
          team_id: string;
          source_retro_id: string;
          source_topic_id: string | null;
          title: string;
          owner_id: string | null;
          due_date: string | null;
          status: string;
          origin: string;
          completed_at: string | null;
          trello_card_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          team_id: string;
          source_retro_id: string;
          source_topic_id?: string | null;
          title: string;
          owner_id?: string | null;
          due_date?: string | null;
          status?: string;
          origin: string;
          completed_at?: string | null;
          trello_card_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          team_id?: string;
          source_retro_id?: string;
          source_topic_id?: string | null;
          title?: string;
          owner_id?: string | null;
          due_date?: string | null;
          status?: string;
          origin?: string;
          completed_at?: string | null;
          trello_card_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      action_item_reviews: {
        Row: {
          id: string;
          action_item_id: string;
          retro_id: string;
          outcome: string;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          action_item_id: string;
          retro_id: string;
          outcome: string;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          action_item_id?: string;
          retro_id?: string;
          outcome?: string;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      topic_notes: {
        Row: {
          topic_id: string;
          body: string;
          updated_at: string;
        };
        Insert: {
          topic_id: string;
          body?: string;
          updated_at?: string;
        };
        Update: {
          topic_id?: string;
          body?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      topic_summaries: {
        Row: {
          id: string;
          topic_id: string;
          version: number;
          model: string;
          prompt_version: string;
          key_points: Json;
          decisions: Json;
          disagreements: Json;
          proposed_action_items: Json;
          edited: boolean;
          edit_ratio: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          topic_id: string;
          version: number;
          model: string;
          prompt_version: string;
          key_points?: Json;
          decisions?: Json;
          disagreements?: Json;
          proposed_action_items?: Json;
          edited?: boolean;
          edit_ratio?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          topic_id?: string;
          version?: number;
          model?: string;
          prompt_version?: string;
          key_points?: Json;
          decisions?: Json;
          disagreements?: Json;
          proposed_action_items?: Json;
          edited?: boolean;
          edit_ratio?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      retro_events: {
        Row: {
          id: string;
          retro_id: string;
          seq: number;
          mutation_id: string;
          type: string;
          payload: Json;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          retro_id: string;
          seq: number;
          mutation_id: string;
          type: string;
          payload: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          retro_id?: string;
          seq?: number;
          mutation_id?: string;
          type?: string;
          payload?: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      team_role: 'admin' | 'member';
      retro_phase: 'setup' | 'review' | 'write' | 'group' | 'vote' | 'discuss' | 'wrap_up' | 'closed';
    };
    CompositeTypes: Record<string, never>;
  };
}
