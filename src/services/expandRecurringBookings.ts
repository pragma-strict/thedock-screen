import { RRule } from 'rrule';
import { DateTime } from 'luxon';
import { OfficeRnDBooking } from './OfficeRnDTypes/Booking';

const FALLBACK_ZONE = 'America/Vancouver';

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
// Recurrence is expanded in the booking's OWN timezone, not UTC. OfficeRnD
// specifies the rule (e.g. `BYDAY=TH`) in local time, so an evening booking
// whose UTC instant lands on the next calendar day would otherwise recur on the
// wrong weekday. We use the well-known "floating" technique: feed the rule wall-
// clock times as if they were UTC, then reinterpret each result back in the
// zone — which also yields the correct offset across DST transitions.
//
// Known caveat (acceptable for a lobby display): a single cancelled occurrence
// within a series isn't represented by the API in a way we detect, so it could
// still be shown.
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

    const zone = booking.timezone || FALLBACK_ZONE;
    const anchorStart = DateTime.fromISO(booking.start, { zone: 'utc' }).setZone(zone);
    const durationMs =
      new Date(booking.end).getTime() - new Date(booking.start).getTime();

    let occurrences: DateTime[];
    try {
      const options = RRule.parseString(rrule);
      options.dtstart = toFloating(anchorStart);
      if (options.until) {
        // `until` parses as a real UTC instant; move it into floating space too.
        options.until = toFloating(
          DateTime.fromJSDate(options.until, { zone: 'utc' }).setZone(zone),
        );
      }
      const floatingStart = toFloating(DateTime.fromJSDate(windowStart, { zone: 'utc' }).setZone(zone));
      const floatingEnd = toFloating(DateTime.fromJSDate(windowEnd, { zone: 'utc' }).setZone(zone));
      // `between` is inclusive on both ends; nudge the upper bound to keep it
      // exclusive so an occurrence exactly at windowEnd isn't double-counted.
      occurrences = new RRule(options)
        .between(floatingStart, new Date(floatingEnd.getTime() - 1), true)
        .map((d) => fromFloating(d, zone));
    } catch {
      // Malformed rule: fall back to the anchor occurrence if it's in-window.
      const start = new Date(booking.start);
      occurrences = start >= windowStart && start < windowEnd ? [anchorStart] : [];
    }

    for (const occStart of occurrences) {
      const startIso = occStart.toUTC().toISO()!;
      const endIso = occStart.toUTC().plus({ milliseconds: durationMs }).toISO()!;
      out.push({
        ...booking,
        _id: `${booking._id}::${startIso}`,
        start: startIso,
        end: endIso,
        recurrence: null,
      });
    }
  }

  return out;
}

// Represent a zoned wall-clock time as a UTC Date carrying the same numbers, so
// rrule (which works in naive UTC) treats them as local clock times.
function toFloating(dt: DateTime): Date {
  return new Date(
    Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second),
  );
}

// Inverse of toFloating: read a floating Date's wall-clock numbers as a time in
// `zone`, producing the correct absolute instant (applying that day's offset).
function fromFloating(d: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    },
    { zone },
  );
}
