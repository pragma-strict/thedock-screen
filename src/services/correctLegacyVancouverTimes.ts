import { DateTime } from 'luxon';
import { OfficeRnDBooking } from './OfficeRnDTypes/Booking';
import {
  OFFICERND_LEGACY_VANCOUVER_ZONE,
  VENUE_ZONE,
} from '../helpers/venueTimeZone';

// OfficeRnD's tz data hasn't caught up with BC's switch to permanent UTC-7
// (Nov 2026). For bookings tagged `America/Vancouver` it still converts the
// wall-clock time staff enter using PST (UTC-8), so the stored UTC instants
// are an hour late; OfficeRnD's own calendar hides this by displaying them
// back with the same stale rules. (Bookings tagged `Canada/Yukon`, the zone
// the location was switched to, are stored correctly and left alone.)
//
// We recover the intended time the same way OfficeRnD's calendar does — read
// the stored instant as a wall-clock time under OfficeRnD's legacy rules —
// then re-anchor that wall-clock time in BC's real zone. Before the cutover
// both zones agree, so older dates are untouched.
//
// Kill switch: once OfficeRnD fixes its tz data and corrects stored bookings,
// this would shift them an hour early. Set OFFICERND_LEGACY_VANCOUVER_FIX=0
// (e.g. in Railway) to disable without a code change, then remove this.
export const LEGACY_VANCOUVER_FIX_ENABLED =
  process.env.OFFICERND_LEGACY_VANCOUVER_FIX !== '0';

const LEGACY_ZONE_NAME = 'America/Vancouver';

export function correctLegacyVancouverTimes(
  bookings: OfficeRnDBooking[],
): OfficeRnDBooking[] {
  return bookings.map((booking) =>
    booking.timezone === LEGACY_ZONE_NAME
      ? {
          ...booking,
          start: reanchor(booking.start),
          end: reanchor(booking.end),
        }
      : booking,
  );
}

function reanchor(iso: string): string {
  const wallClock = DateTime.fromISO(iso, {
    zone: OFFICERND_LEGACY_VANCOUVER_ZONE,
  });
  return wallClock
    .setZone(VENUE_ZONE, { keepLocalTime: true })
    .toUTC()
    .toISO()!;
}
