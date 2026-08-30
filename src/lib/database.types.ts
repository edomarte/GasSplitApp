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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      cars: {
        Row: {
          created_at: string
          created_by: string
          currency: string
          id: string
          initial_odometer_km: number
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          initial_odometer_km?: number
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          initial_odometer_km?: number
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "cars_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fill_shares: {
        Row: {
          amount_cents: number
          fill_id: string
          km_scale: number
          km_scaled: number
          user_id: string
        }
        Insert: {
          amount_cents: number
          fill_id: string
          km_scale: number
          km_scaled: number
          user_id: string
        }
        Update: {
          amount_cents?: number
          fill_id?: string
          km_scale?: number
          km_scaled?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fill_shares_fill_id_fkey"
            columns: ["fill_id"]
            isOneToOne: false
            referencedRelation: "fills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fill_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fills: {
        Row: {
          car_id: string
          created_at: string
          filled_on: string
          id: string
          odometer_km: number | null
          paid_by: string
          total_cents: number
        }
        Insert: {
          car_id: string
          created_at?: string
          filled_on: string
          id?: string
          odometer_km?: number | null
          paid_by: string
          total_cents: number
        }
        Update: {
          car_id?: string
          created_at?: string
          filled_on?: string
          id?: string
          odometer_km?: number | null
          paid_by?: string
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "fills_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "car_odometer"
            referencedColumns: ["car_id"]
          },
          {
            foreignKeyName: "fills_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fills_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          car_id: string
          created_at: string
          created_by: string
          expires_at: string
          id: string
          invited_email: string | null
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          car_id: string
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          invited_email?: string | null
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          car_id?: string
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          invited_email?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "car_odometer"
            referencedColumns: ["car_id"]
          },
          {
            foreignKeyName: "invites_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          car_id: string
          joined_at: string
          role: string
          user_id: string
        }
        Insert: {
          car_id: string
          joined_at?: string
          role?: string
          user_id: string
        }
        Update: {
          car_id?: string
          joined_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "car_odometer"
            referencedColumns: ["car_id"]
          },
          {
            foreignKeyName: "memberships_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          email: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trip_shares: {
        Row: {
          trip_id: string
          user_id: string
        }
        Insert: {
          trip_id: string
          user_id: string
        }
        Update: {
          trip_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_shares_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          car_id: string
          created_at: string
          distance_km: number | null
          driven_on: string
          end_km: number
          fill_id: string | null
          id: string
          note: string | null
          recorded_by: string
          start_km: number
        }
        Insert: {
          car_id: string
          created_at?: string
          distance_km?: number | null
          driven_on: string
          end_km: number
          fill_id?: string | null
          id?: string
          note?: string | null
          recorded_by: string
          start_km: number
        }
        Update: {
          car_id?: string
          created_at?: string
          distance_km?: number | null
          driven_on?: string
          end_km?: number
          fill_id?: string | null
          id?: string
          note?: string | null
          recorded_by?: string
          start_km?: number
        }
        Relationships: [
          {
            foreignKeyName: "trips_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "car_odometer"
            referencedColumns: ["car_id"]
          },
          {
            foreignKeyName: "trips_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_fill_id_fkey"
            columns: ["fill_id"]
            isOneToOne: false
            referencedRelation: "fills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      car_odometer: {
        Row: {
          car_id: string | null
          last_km: number | null
        }
        Relationships: []
      }
      open_period_km: {
        Row: {
          car_id: string | null
          km: number | null
          trip_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trips_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "car_odometer"
            referencedColumns: ["car_id"]
          },
          {
            foreignKeyName: "trips_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      derive_display_name: {
        Args: { p_email: string; p_meta: Json }
        Returns: string
      }
      invite_preview: { Args: { p_token_hash: string }; Returns: Json }
      is_car_member: { Args: { p_car_id: string }; Returns: boolean }
      is_car_owner: { Args: { p_car_id: string }; Returns: boolean }
      redeem_invite: { Args: { p_token_hash: string }; Returns: Json }
      shares_car_with: { Args: { p_user_id: string }; Returns: boolean }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
