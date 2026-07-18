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
      balance_adjustments: {
        Row: {
          amount_minor: number
          created_at: string
          date: string
          deleted_at: string | null
          id: string
          note: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          date: string
          deleted_at?: string | null
          id: string
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          date?: string
          deleted_at?: string | null
          id?: string
          note?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          icon: string | null
          id: string
          is_column: boolean
          kind: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id: string
          is_column?: boolean
          kind: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          icon?: string | null
          id?: string
          is_column?: boolean
          kind?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cell_notes: {
        Row: {
          body: string
          category_id: string
          created_at: string
          deleted_at: string | null
          id: string
          month: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          category_id: string
          created_at?: string
          deleted_at?: string | null
          id: string
          month: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          body?: string
          category_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          month?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cell_notes_user_category_fk"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      computed_columns: {
        Row: {
          created_at: string
          definition: Json
          deleted_at: string | null
          id: string
          name: string
          sort_order: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          definition: Json
          deleted_at?: string | null
          id: string
          name: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          definition?: Json
          deleted_at?: string | null
          id?: string
          name?: string
          sort_order?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_card_statements: {
        Row: {
          created_at: string
          deleted_at: string | null
          due_date: string
          id: string
          payment_source_id: string
          period_month: string
          statement_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          due_date: string
          id: string
          payment_source_id: string
          period_month: string
          statement_date: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          due_date?: string
          id?: string
          payment_source_id?: string
          period_month?: string
          statement_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_card_statements_user_source_fk"
            columns: ["user_id", "payment_source_id"]
            isOneToOne: false
            referencedRelation: "payment_sources"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      expected_payments: {
        Row: {
          amount_minor: number
          auto_confirmed: boolean
          created_at: string
          currency: string
          deleted_at: string | null
          direction: string
          due_date: string
          id: string
          kind: string
          paid_at: string | null
          ref_id: string
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          auto_confirmed?: boolean
          created_at?: string
          currency?: string
          deleted_at?: string | null
          direction: string
          due_date: string
          id: string
          kind: string
          paid_at?: string | null
          ref_id: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_minor?: number
          auto_confirmed?: boolean
          created_at?: string
          currency?: string
          deleted_at?: string | null
          direction?: string
          due_date?: string
          id?: string
          kind?: string
          paid_at?: string | null
          ref_id?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expected_payments_user_transaction_fk"
            columns: ["user_id", "transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          created_at: string
          currency: string
          deleted_at: string | null
          id: string
          rate_date: string
          rate_try: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency: string
          deleted_at?: string | null
          id: string
          rate_date: string
          rate_try: number
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          currency?: string
          deleted_at?: string | null
          id?: string
          rate_date?: string
          rate_try?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      installment_plans: {
        Row: {
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          due_day: number | null
          id: string
          installment_count: number
          kind: string
          monthly_amount_minor: number | null
          note: string | null
          payment_source_id: string | null
          person_id: string
          start_month: string
          title: string
          total_amount_minor: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          due_day?: number | null
          id: string
          installment_count: number
          kind: string
          monthly_amount_minor?: number | null
          note?: string | null
          payment_source_id?: string | null
          person_id: string
          start_month: string
          title: string
          total_amount_minor?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          due_day?: number | null
          id?: string
          installment_count?: number
          kind?: string
          monthly_amount_minor?: number | null
          note?: string | null
          payment_source_id?: string | null
          person_id?: string
          start_month?: string
          title?: string
          total_amount_minor?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_user_category_fk"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "installment_plans_user_person_fk"
            columns: ["user_id", "person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "installment_plans_user_source_fk"
            columns: ["user_id", "payment_source_id"]
            isOneToOne: false
            referencedRelation: "payment_sources"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      keep_alive: {
        Row: {
          id: number
          pinged_at: string
        }
        Insert: {
          id: number
          pinged_at?: string
        }
        Update: {
          id?: number
          pinged_at?: string
        }
        Relationships: []
      }
      payment_sources: {
        Row: {
          color: string | null
          created_at: string
          deleted_at: string | null
          due_day: number | null
          id: string
          is_active: boolean
          logo_ref: string | null
          logo_source: string
          name: string
          person_id: string
          statement_day: number | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          due_day?: number | null
          id: string
          is_active?: boolean
          logo_ref?: string | null
          logo_source?: string
          name: string
          person_id: string
          statement_day?: number | null
          type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          deleted_at?: string | null
          due_day?: number | null
          id?: string
          is_active?: boolean
          logo_ref?: string | null
          logo_source?: string
          name?: string
          person_id?: string
          statement_day?: number | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_sources_user_person_fk"
            columns: ["user_id", "person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      persons: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          is_self: boolean
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id: string
          is_self?: boolean
          name: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_self?: boolean
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          deleted_at: string | null
          effective_from: string
          id: string
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          deleted_at?: string | null
          effective_from: string
          id: string
          subscription_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          deleted_at?: string | null
          effective_from?: string
          id?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_user_subscription_fk"
            columns: ["user_id", "subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      recurring_incomes: {
        Row: {
          category_id: string | null
          created_at: string
          currency: string
          default_amount_minor: number
          deleted_at: string | null
          id: string
          is_active: boolean
          kind: string
          name: string
          note: string | null
          pay_day: number
          person_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          currency?: string
          default_amount_minor: number
          deleted_at?: string | null
          id: string
          is_active?: boolean
          kind?: string
          name: string
          note?: string | null
          pay_day: number
          person_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          currency?: string
          default_amount_minor?: number
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          kind?: string
          name?: string
          note?: string | null
          pay_day?: number
          person_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_incomes_user_category_fk"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "recurring_incomes_user_person_fk"
            columns: ["user_id", "person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          key: string
          updated_at: string
          user_id: string
          value: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id: string
          key: string
          updated_at?: string
          user_id?: string
          value: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          key?: string
          updated_at?: string
          user_id?: string
          value?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_minor: number
          auto_pay: boolean
          billing_day: number
          canceled_at: string | null
          category_id: string | null
          created_at: string
          currency: string
          cycle: string
          deleted_at: string | null
          id: string
          interval_months: number
          is_active: boolean
          logo_ref: string | null
          logo_source: string
          name: string
          next_due_date: string
          note: string | null
          payment_source_id: string | null
          person_id: string
          trial_end_date: string | null
          updated_at: string
          user_id: string
          website_domain: string | null
        }
        Insert: {
          amount_minor: number
          auto_pay?: boolean
          billing_day: number
          canceled_at?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          cycle: string
          deleted_at?: string | null
          id: string
          interval_months?: number
          is_active?: boolean
          logo_ref?: string | null
          logo_source?: string
          name: string
          next_due_date: string
          note?: string | null
          payment_source_id?: string | null
          person_id: string
          trial_end_date?: string | null
          updated_at?: string
          user_id?: string
          website_domain?: string | null
        }
        Update: {
          amount_minor?: number
          auto_pay?: boolean
          billing_day?: number
          canceled_at?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          cycle?: string
          deleted_at?: string | null
          id?: string
          interval_months?: number
          is_active?: boolean
          logo_ref?: string | null
          logo_source?: string
          name?: string
          next_due_date?: string
          note?: string | null
          payment_source_id?: string | null
          person_id?: string
          trial_end_date?: string | null
          updated_at?: string
          user_id?: string
          website_domain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_category_fk"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "subscriptions_user_person_fk"
            columns: ["user_id", "person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "subscriptions_user_source_fk"
            columns: ["user_id", "payment_source_id"]
            isOneToOne: false
            referencedRelation: "payment_sources"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount_minor: number
          amount_try_minor: number
          card_statement_id: string | null
          category_id: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          effective_date: string
          entry_date: string
          fx_rate: number | null
          id: string
          installment_no: number | null
          installment_plan_id: string | null
          is_aggregate: boolean
          note: string | null
          payment_source_id: string | null
          person_id: string
          purchase_date: string | null
          status: string
          subscription_id: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          amount_try_minor: number
          card_statement_id?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          effective_date: string
          entry_date: string
          fx_rate?: number | null
          id: string
          installment_no?: number | null
          installment_plan_id?: string | null
          is_aggregate?: boolean
          note?: string | null
          payment_source_id?: string | null
          person_id: string
          purchase_date?: string | null
          status: string
          subscription_id?: string | null
          type: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount_minor?: number
          amount_try_minor?: number
          card_statement_id?: string | null
          category_id?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          effective_date?: string
          entry_date?: string
          fx_rate?: number | null
          id?: string
          installment_no?: number | null
          installment_plan_id?: string | null
          is_aggregate?: boolean
          note?: string | null
          payment_source_id?: string | null
          person_id?: string
          purchase_date?: string | null
          status?: string
          subscription_id?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_category_fk"
            columns: ["user_id", "category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transactions_user_person_fk"
            columns: ["user_id", "person_id"]
            isOneToOne: false
            referencedRelation: "persons"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transactions_user_plan_fk"
            columns: ["user_id", "installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transactions_user_source_fk"
            columns: ["user_id", "payment_source_id"]
            isOneToOne: false
            referencedRelation: "payment_sources"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transactions_user_statement_fk"
            columns: ["user_id", "card_statement_id"]
            isOneToOne: false
            referencedRelation: "credit_card_statements"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transactions_user_subscription_fk"
            columns: ["user_id", "subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_own_account: { Args: never; Returns: undefined }
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
