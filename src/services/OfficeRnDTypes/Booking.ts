export type OfficeRnDBooking = {
  _id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  timezone: string;
  resource: string;
  company: string;
  member: string | null;
  isCancelled?: boolean;
  // Recurrence: a recurring booking is returned as a single anchor row whose
  // `start`/`end` are the first occurrence and `recurrence.rrule` is an iCal
  // RRULE string. Later occurrences are not materialized by the API and must be
  // expanded client-side (see expandRecurringBookings).
  recurrence?: { rrule: string | null } | null;
  seriesStart?: string;
  seriesEnd?: string;
  // Add-on services attached to the booking (coffee, AV, etc.). Each `_id`
  // references a plan of type "service"; `count` is the quantity.
  extras?: { _id: string; count: number }[];
};

export type AppBooking = {
  _id: string;
  startDateTime: string;
  endDateTime: string;
  timezone: string;
  room: string;
  floor: string;
  summary: string;
  host: string;
  // Number of people the coffee service is attached for; 0 when no coffee.
  coffeeCount: number;
};

