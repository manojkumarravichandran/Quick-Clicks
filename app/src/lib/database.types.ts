// Generated from the Supabase schema (supabase/migrations). Regenerate after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type BookingRow = {
  accepted_at: string | null
  address: string
  cancel_reason: string | null
  contact_phone: string | null
  created_at: string
  crew_id: string | null
  customer_id: string
  deliverables_url: string | null
  distance_km: number | null
  eta_minutes: number | null
  id: string
  location: unknown
  mode: Database['public']['Enums']['booking_mode']
  notes: string
  package_id: string
  payment_status: Database['public']['Enums']['payment_status']
  price_inr: number
  scheduled_at: string | null
  status: Database['public']['Enums']['booking_status']
  updated_at: string
}

type CrewRow = {
  approved: boolean
  bio: string
  created_at: string
  display_name: string
  id: string
  is_online: boolean
  kind: Database['public']['Enums']['crew_kind']
  location: unknown
  location_updated_at: string | null
  rating: number
  tier: Database['public']['Enums']['crew_tier']
}

type PackageRow = {
  category: Database['public']['Enums']['package_category']
  created_at: string
  crew_kind: Database['public']['Enums']['crew_kind'] | null
  description: string
  duration_hours: number
  features: string[]
  id: string
  is_active: boolean
  name: string
  price_inr: number
  slug: string
  sort_order: number
  tier: Database['public']['Enums']['crew_tier'] | null
}

type ProfileRow = {
  created_at: string
  full_name: string | null
  id: string
  phone: string | null
  role: Database['public']['Enums']['user_role']
}

type EventRow = {
  actor_id: string | null
  booking_id: string
  created_at: string
  id: number
  note: string | null
  status: Database['public']['Enums']['booking_status']
}

type BookingSetof = { from: '*'; to: 'bookings'; isOneToOne: true; isSetofReturn: false }
type CrewSetof = { from: '*'; to: 'crew_members'; isOneToOne: true; isSetofReturn: false }

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.18' }
  public: {
    Tables: {
      booking_events: {
        Row: EventRow
        Insert: Omit<EventRow, 'id' | 'created_at' | 'actor_id' | 'note'> & {
          id?: never
          created_at?: string
          actor_id?: string | null
          note?: string | null
        }
        Update: Partial<Omit<EventRow, 'id'>> & { id?: never }
        Relationships: [
          { foreignKeyName: 'booking_events_actor_id_fkey'; columns: ['actor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'booking_events_booking_id_fkey'; columns: ['booking_id']; isOneToOne: false; referencedRelation: 'bookings'; referencedColumns: ['id'] },
        ]
      }
      bookings: {
        Row: BookingRow
        Insert: Partial<BookingRow> & Pick<BookingRow, 'address' | 'customer_id' | 'mode' | 'package_id' | 'price_inr'>
        Update: Partial<BookingRow>
        Relationships: [
          { foreignKeyName: 'bookings_crew_id_fkey'; columns: ['crew_id']; isOneToOne: false; referencedRelation: 'crew_members'; referencedColumns: ['id'] },
          { foreignKeyName: 'bookings_customer_id_fkey'; columns: ['customer_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] },
          { foreignKeyName: 'bookings_package_id_fkey'; columns: ['package_id']; isOneToOne: false; referencedRelation: 'packages'; referencedColumns: ['id'] },
        ]
      }
      crew_members: {
        Row: CrewRow
        Insert: Partial<CrewRow> & Pick<CrewRow, 'display_name' | 'id' | 'kind'>
        Update: Partial<CrewRow>
        Relationships: [
          { foreignKeyName: 'crew_members_id_fkey'; columns: ['id']; isOneToOne: true; referencedRelation: 'profiles'; referencedColumns: ['id'] },
        ]
      }
      packages: {
        Row: PackageRow
        Insert: Partial<PackageRow> & Pick<PackageRow, 'category' | 'duration_hours' | 'name' | 'price_inr' | 'slug'>
        Update: Partial<PackageRow>
        Relationships: []
      }
      profiles: {
        Row: ProfileRow
        Insert: Partial<ProfileRow> & Pick<ProfileRow, 'id'>
        Update: Partial<ProfileRow>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      admin_assign_crew: { Args: { p_booking_id: string; p_crew_id: string }; Returns: BookingRow; SetofOptions: BookingSetof }
      admin_set_crew_approval: {
        Args: { p_approved: boolean; p_crew_id: string; p_tier?: Database['public']['Enums']['crew_tier'] }
        Returns: CrewRow
        SetofOptions: CrewSetof
      }
      admin_set_role: { Args: { p_role: Database['public']['Enums']['user_role']; p_user_id: string }; Returns: undefined }
      apply_as_crew: {
        Args: { p_bio?: string; p_display_name: string; p_kind: Database['public']['Enums']['crew_kind'] }
        Returns: CrewRow
        SetofOptions: CrewSetof
      }
      booking_crew_info: {
        Args: { p_booking_id: string }
        Returns: {
          display_name: string
          kind: Database['public']['Enums']['crew_kind']
          rating: number
          tier: Database['public']['Enums']['crew_tier']
        }[]
      }
      booking_crew_location: {
        Args: { p_booking_id: string }
        Returns: { display_name: string; lat: number; lng: number; updated_at: string }[]
      }
      booking_customer_info: {
        Args: { p_booking_id: string }
        Returns: { full_name: string; lat: number; lng: number; phone: string }[]
      }
      cancel_booking: { Args: { p_booking_id: string; p_reason?: string }; Returns: BookingRow; SetofOptions: BookingSetof }
      create_scheduled_booking: {
        Args: {
          p_address: string
          p_contact_phone: string
          p_lat?: number
          p_lng?: number
          p_notes?: string
          p_package_id: string
          p_scheduled_at: string
        }
        Returns: BookingRow
        SetofOptions: BookingSetof
      }
      crew_advance: { Args: { p_booking_id: string; p_deliverables_url?: string }; Returns: BookingRow; SetofOptions: BookingSetof }
      crew_respond: { Args: { p_accept: boolean; p_booking_id: string }; Returns: BookingRow; SetofOptions: BookingSetof }
      crew_set_online: { Args: { p_lat?: number; p_lng?: number; p_online: boolean }; Returns: undefined }
      crew_update_location: { Args: { p_lat: number; p_lng: number }; Returns: undefined }
      estimate_eta_minutes: { Args: { distance_km: number }; Returns: number }
      is_admin: { Args: never; Returns: boolean }
      nearby_crew: {
        Args: { p_lat: number; p_lng: number; p_radius_km?: number }
        Returns: {
          approx_lat: number
          approx_lng: number
          crew_id: string
          display_name: string
          distance_km: number
          eta_minutes: number
          kind: Database['public']['Enums']['crew_kind']
          rating: number
          tier: Database['public']['Enums']['crew_tier']
        }[]
      }
      request_instant_booking: {
        Args: {
          p_address: string
          p_contact_phone: string
          p_crew_id: string
          p_lat: number
          p_lng: number
          p_notes?: string
          p_package_id: string
        }
        Returns: BookingRow
        SetofOptions: BookingSetof
      }
    }
    Enums: {
      booking_mode: 'scheduled' | 'instant'
      booking_status: 'requested' | 'accepted' | 'declined' | 'en_route' | 'arrived' | 'shooting' | 'editing' | 'delivered' | 'cancelled'
      crew_kind: 'photographer' | 'videographer' | 'full_crew'
      crew_tier: 'lite' | 'pro' | 'ultra'
      package_category: 'shoot' | 'wedding' | 'instant'
      payment_status: 'unpaid' | 'advance_paid' | 'paid' | 'refunded'
      user_role: 'customer' | 'crew' | 'admin'
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database['public']
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]
export type RpcReturn<T extends keyof PublicSchema['Functions']> = PublicSchema['Functions'][T]['Returns']
