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

export interface OrderRecord {
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
  tickets: { ref: string; guestNumber: number; status: string; checkedInAt: string | null }[];
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
