import type { Enums } from './database.types'

export const inr = (n: number) => '₹' + n.toLocaleString('en-IN')

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export const STATUS_LABEL: Record<Enums<'booking_status'>, string> = {
  requested: 'Waiting for crew',
  accepted: 'Crew confirmed',
  declined: 'Crew declined',
  en_route: 'Crew on the way',
  arrived: 'Crew has arrived',
  shooting: 'Shooting',
  editing: 'Editing',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

/** Order of the happy path, used for progress bars. */
export const STATUS_STEPS: Enums<'booking_status'>[] = ['requested', 'accepted', 'en_route', 'arrived', 'shooting', 'editing', 'delivered']

export const ACTIVE_STATUSES: Enums<'booking_status'>[] = ['requested', 'accepted', 'en_route', 'arrived', 'shooting', 'editing']

export const KIND_LABEL: Record<Enums<'crew_kind'>, string> = {
  photographer: 'Photographer',
  videographer: 'Videographer',
  full_crew: 'Full crew',
}

export const TIER_LABEL: Record<Enums<'crew_tier'>, string> = { lite: 'Lite', pro: 'Pro', ultra: 'Ultra' }

export const PAYMENT_LABEL: Record<Enums<'payment_status'>, string> = {
  unpaid: 'Unpaid',
  advance_paid: 'Advance paid',
  paid: 'Paid',
  refunded: 'Refunded',
}
