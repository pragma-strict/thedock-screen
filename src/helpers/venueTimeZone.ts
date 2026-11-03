import { FixedOffsetZone, IANAZone, Zone } from 'luxon';

// British Columbia dropped seasonal clock changes and stayed on UTC-7 when
// daylight time would have ended on 2026-11-01 (02:00 PDT = 09:00 UTC). The
// tz database bundled with Node (`process.versions.tz`) predates that change,
// so its `America/Vancouver` still falls back to UTC-8, which pushes every
// time we compute in that zone an hour late.
//
// This zone uses the real `America/Vancouver` history before the cutover (so
// recurring series anchored in an old PST winter still resolve correctly) and
// a fixed UTC-7 from then on. Once the bundled tzdata knows about the change,
// both halves agree and this becomes a no-op.
const BC_PERMANENT_UTC_MINUS_7_FROM = Date.UTC(2026, 10, 1, 9, 0, 0);
const vancouver = IANAZone.create('America/Vancouver');
const utcMinus7 = FixedOffsetZone.instance(-7 * 60);

class BritishColumbiaZone extends Zone {
  private pick(ts: number): Zone {
    return ts >= BC_PERMANENT_UTC_MINUS_7_FROM ? utcMinus7 : vancouver;
  }
  get type() {
    return 'bc';
  }
  get name() {
    return 'America/Vancouver';
  }
  get isUniversal() {
    return false;
  }
  get isValid() {
    return true;
  }
  offsetName(ts: number, opts: { format?: 'short' | 'long'; locale?: string }) {
    return ts >= BC_PERMANENT_UTC_MINUS_7_FROM
      ? 'MST'
      : vancouver.offsetName(ts, opts as any);
  }
  formatOffset(ts: number, format: 'narrow' | 'short' | 'techie') {
    return this.pick(ts).formatOffset(ts, format);
  }
  offset(ts: number) {
    return this.pick(ts).offset(ts);
  }
  equals(other: Zone) {
    return other instanceof BritishColumbiaZone;
  }
}

export const VENUE_ZONE: Zone = new BritishColumbiaZone();

// Bookings carry an IANA zone name. Route BC's zone (and a missing one) through
// the patched zone; anything else is used as-is.
export function resolveZone(name: string | undefined | null): Zone | string {
  if (!name || name === 'America/Vancouver') return VENUE_ZONE;
  return name;
}
