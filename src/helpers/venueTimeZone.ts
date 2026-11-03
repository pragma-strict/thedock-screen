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

// What OfficeRnD currently means by "America/Vancouver": its tz data still
// has the pre-2026 rules, so after the cutover it keeps switching between
// PST (UTC-8, winter) and PDT (UTC-7, from the 2nd Sunday of March at 02:00
// to the 1st Sunday of November at 02:00). Defined explicitly rather than via
// the runtime's tz data, which may or may not have caught up.
const pst = FixedOffsetZone.instance(-8 * 60);

function legacyIsDaylight(ts: number): boolean {
  const year = new Date(ts).getUTCFullYear();
  const nthSunday = (month: number, n: number) => {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return 1 + ((7 - firstDow) % 7) + (n - 1) * 7;
  };
  const dstStart = Date.UTC(year, 2, nthSunday(2, 2), 10); // 02:00 PST
  const dstEnd = Date.UTC(year, 10, nthSunday(10, 1), 9); // 02:00 PDT
  return ts >= dstStart && ts < dstEnd;
}

class LegacyVancouverZone extends Zone {
  private pick(ts: number): Zone {
    if (ts < BC_PERMANENT_UTC_MINUS_7_FROM) return vancouver;
    return legacyIsDaylight(ts) ? utcMinus7 : pst;
  }
  get type() {
    return 'legacy-vancouver';
  }
  get name() {
    return 'America/Vancouver (pre-2026 rules)';
  }
  get isUniversal() {
    return false;
  }
  get isValid() {
    return true;
  }
  offsetName(ts: number, opts: { format?: 'short' | 'long'; locale?: string }) {
    if (ts < BC_PERMANENT_UTC_MINUS_7_FROM) return vancouver.offsetName(ts, opts as any);
    return legacyIsDaylight(ts) ? 'PDT' : 'PST';
  }
  formatOffset(ts: number, format: 'narrow' | 'short' | 'techie') {
    return this.pick(ts).formatOffset(ts, format);
  }
  offset(ts: number) {
    return this.pick(ts).offset(ts);
  }
  equals(other: Zone) {
    return other instanceof LegacyVancouverZone;
  }
}

export const OFFICERND_LEGACY_VANCOUVER_ZONE: Zone = new LegacyVancouverZone();

// Bookings carry an IANA zone name. Route BC's zone (and a missing one) through
// the patched zone; anything else is used as-is.
export function resolveZone(name: string | undefined | null): Zone | string {
  if (!name || name === 'America/Vancouver') return VENUE_ZONE;
  return name;
}
