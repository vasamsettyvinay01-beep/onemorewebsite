export type StaffRole = "super_admin" | "admin";

export interface TierMetric {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  admits: number;
  unitsSold: number;
  unitsRefunded: number;
  admissionsIssued: number;
  admissionsOutstanding: number;
  capacity: number | null;
  remaining: number | null;
  holds: number;
  revenue: number;
  status: string;
}

export interface TimelinePoint {
  date: string;
  orders: number;
  charged: number;
  refunded: number;
  issued: number;
}

/** One ticket-type line of a mixed-ticket order. Older single-ticket orders have none. */
export interface OrderLine {
  tierId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  admissions: number;
  lineSubtotal: number;
  promoEligible: boolean;
  discount: number;
  discountedSubtotal: number;
  tax: number;
  lineTotal: number;
}

export interface OrderRecord {
  items?: OrderLine[];
  ref: string;
  purchaser: string | null;
  email: string;
  eventId: string;
  eventName: string;
  tier: string;
  tierId: string;
  units: number;
  admissions: number;
  subtotal: number | null;
  tax: number | null;
  total: number;
  currency: string;
  paymentStatus: string;
  refundStatus: string;
  emailStatus: string;
  createdAt: string;
  promoCode: string | null;
  promoLabel: string | null;
  discountPercent: number | null;
  originalSubtotal: number | null;
  discount: number | null;
}

export interface PromoOrder {
  items?: OrderLine[];
  /** Passes on the lines the code actually discounted. */
  discountedAdmissions?: number;
  ref: string;
  purchaser: string | null;
  email: string;
  tier: string;
  units: number;
  admissions: number;
  promoCode: string | null;
  discountPercent: number | null;
  originalSubtotal: number | null;
  discount: number | null;
  subtotal: number | null;
  tax: number | null;
  total: number;
  currency: string;
  paymentStatus: string;
  refundStatus: string;
  createdAt: string;
}

export interface PromoPerformance {
  code: string;
  discountType: string;
  discountValue: number;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  currency: string;
  summary: {
    orders: number;
    currentOrders: number;
    refundedOrders: number;
    disputedOrders: number;
    admissionsActive: number;
    admissionsIssued: number;
    /** Every pass in an order that used the code, including lines the code did not discount. */
    orderAdmissionsActive?: number;
    orderAdmissionsIssued?: number;
    originalValue: number;
    discounts: number;
    netSubtotal: number;
    tax: number;
    totalPaid: number;
    grossSales: number;
    refunds: number;
    disputed: number;
    netRevenue: number;
  };
  orders: PromoOrder[];
}

export interface Overview {
  event: {
    id: string;
    name: string;
    date: string | null;
    time: string | null;
    venue: string | null;
    address: string | null;
    age: string | null;
    salesStatus: string;
    status: string;
    timezone: string;
  };
  currency: string;
  grossSales: number;
  orders: number;
  admissionsSold: number;
  passesIssued: number;
  capacity: number | null;
  remainingCapacity: number | null;
  uncappedTiers: number;
  checkedIn: number;
  guestsRemaining: number;
  ticketSubtotal: number | null;
  taxCollected: number | null;
  refundedAmount: number;
  cancelledPasses: number;
  activeHolds: number;
  totalsComplete: boolean;
  tiers: TierMetric[];
  timeline: { timezone: string; today: string | null; points: TimelinePoint[] };
  recentOrders: OrderRecord[];
}

export interface OrderDetail {
  order: OrderRecord;
  admits: number;
  tickets: { ref: string; guestNumber: number; tier?: string; status: string; checkedInAt: string | null }[];
}

export interface AdminEvent {
  id: string;
  name: string;
  date: string | null;
  time: string | null;
  venue: string | null;
  address: string | null;
  age: string | null;
  status: string;
  salesStatus: string;
  currency: string;
  capacity: number | null;
  remainingCapacity: number | null;
  uncappedTiers: number;
  unitsSold: number;
  admissionsSold: number;
  passesIssued: number;
  tiers: { id: string; name: string; priceCents: number; admits: number; capacity: number | null; active: boolean }[];
  promoCodes?: string[];
}

export interface TicketRecord {
  ref: string;
  tier: string;
  guestNumber: number;
  status: string;
  checkedIn: boolean;
  checkedInAt: string | null;
  orderRef: string;
  eventName?: string;
}

export interface CheckInReport {
  expected: number;
  checkedIn: number;
  remaining: number;
  cancelled: number;
  percent: number | null;
  scans: { at: string; ref: string | null; tier: string | null; result: string }[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEntry {
  at: string;
  actor: string;
  role: string | null;
  action: string;
  resource: string | null;
  resourceRef: string | null;
  summary: Record<string, string | number | boolean | null>;
}

export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  rows: T[];
}
