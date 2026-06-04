import { rrulestr } from 'rrule';
import { DateTime } from 'luxon';
import { OfficeRnDBooking } from './OfficeRnDTypes/Booking';

// OfficeRnD returns a recurring booking as a single anchor row carrying an iCal
// RRULE; it does not materialize later occurrences. This expands the bookings in
// a window into concrete occurrences:
//
//   - one-off bookings (no rrule) pass through unchanged if they start inside
//     the window;
//   - recurring bookings are expanded into one synthetic booking per occurrence
//     that falls inside the window, each carrying the occurrence's start/end and
//     a unique `_id` so it can be keyed/rendered independently.
//
// The window bounds are absolute UTC instants and `windowEnd` is exclusive.
//
// Caveats (acceptable for a today/tomorrow lobby display):
//   - Occurrences are computed in UTC from the anchor instant; across a DST
//     transition an occurrence's local time could shift by an hour.
//   - A single cancelled occurrence within a series is not represented by the
//     API in a way we detect, so it could still be shown.
export function expandRecurringBookings(
  bookings: OfficeRnDBooking[],
  windowStart: Date,
  windowEnd: Date,
): OfficeRnDBooking[] {
  const out: OfficeRnDBooking[] = [];

  for (const booking of bookings) {
    const rrule = booking.recurrence?.rrule;

    if (!rrule) {
      const start = new Date(booking.start);
      if (start >= windowStart && start < windowEnd) out.push(booking);
      continue;
    }

    const anchorStart = new Date(booking.start);
    const durationMs = new Date(booking.end).getTime() - anchorStart.getTime();

    let occurrences: Date[];
    try {
      const dtstart = DateTime.fromJSDate(anchorStart, { zone: 'utc' }).toFormat(
        "yyyyMMdd'T'HHmmss'Z'",
      );
      const rule = rrulestr(`DTSTART:${dtstart}\nRRULE:${rrule}`);
      // `between` is inclusive on both ends; nudge the upper bound to keep it
      // exclusive so an occurrence exactly at windowEnd isn't double-counted.
      occurrences = rule.between(windowStart, new Date(windowEnd.getTime() - 1), true);
    } catch {
      // Malformed rule: fall back to the anchor occurrence if it's in-window.
      occurrences =
        anchorStart >= windowStart && anchorStart < windowEnd ? [anchorStart] : [];
    }

    for (const occStart of occurrences) {
      const occEnd = new Date(occStart.getTime() + durationMs);
      out.push({
        ...booking,
        _id: `${booking._id}::${occStart.toISOString()}`,
        start: occStart.toISOString(),
        end: occEnd.toISOString(),
        recurrence: null,
      });
    }
  }

  return out;
}
