import { OfficeRnDBooking } from './OfficeRnDTypes/Booking';
import { expandRecurringBookings } from './expandRecurringBookings';

// Window: 2026-06-04 00:00 .. 2026-06-06 00:00 America/Vancouver (PDT, -07:00),
// i.e. today (Thu Jun 4) + tomorrow (Fri Jun 5), as UTC instants.
const windowStart = new Date('2026-06-04T07:00:00.000Z');
const windowEnd = new Date('2026-06-06T07:00:00.000Z');

const booking = (b: Partial<OfficeRnDBooking>): OfficeRnDBooking =>
  ({
    _id: 'id',
    title: 't',
    timezone: 'America/Vancouver',
    resource: 'r',
    company: 'c',
    member: null,
    ...b,
  } as OfficeRnDBooking);

test('one-off starting inside the window passes through unchanged', () => {
  const b = booking({ start: '2026-06-04T20:00:00.000Z', end: '2026-06-04T21:00:00.000Z' });
  expect(expandRecurringBookings([b], windowStart, windowEnd)).toEqual([b]);
});

test('one-off starting before the window is dropped', () => {
  const b = booking({ start: '2026-06-01T20:00:00.000Z', end: '2026-06-01T21:00:00.000Z' });
  expect(expandRecurringBookings([b], windowStart, windowEnd)).toEqual([]);
});

test('recurring series expands to in-window occurrences with kept duration and unique ids', () => {
  // Anchored Wed Jun 3 10:00 Vancouver, recurs Wed+Fri until Jun 26.
  const b = booking({
    _id: 'monkhouse',
    start: '2026-06-03T17:00:00.000Z',
    end: '2026-06-03T18:00:00.000Z',
    recurrence: { rrule: 'FREQ=WEEKLY;UNTIL=20260626T170000Z;BYDAY=WE,FR;WKST=SU' },
  });
  const out = expandRecurringBookings([b], windowStart, windowEnd);
  // Wed Jun 3 is before the window; only Fri Jun 5 lands inside it.
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({
    _id: 'monkhouse::2026-06-05T17:00:00.000Z',
    start: '2026-06-05T17:00:00.000Z',
    end: '2026-06-05T18:00:00.000Z',
    recurrence: null,
  });
});

test('recurring anchor that itself lands in the window is included', () => {
  // Weekly Thursday; Thu Jun 4 is in-window.
  const b = booking({
    start: '2026-06-04T21:00:00.000Z',
    end: '2026-06-04T22:00:00.000Z',
    recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH;WKST=SU' },
  });
  const out = expandRecurringBookings([b], windowStart, windowEnd);
  expect(out.map((o) => o.start)).toEqual(['2026-06-04T21:00:00.000Z']);
});

test('evening series recurs on the correct local weekday (not the UTC one)', () => {
  // 6pm Vancouver = next-day 01:00 UTC, so the anchor's UTC weekday (Fri) differs
  // from its local weekday (Thu). The rule says BYDAY=TH (local); today is Thu
  // Jun 4, so tonight's occurrence must appear — expanding in UTC would miss it.
  const b = booking({
    start: '2026-05-22T01:00:00.000Z', // Thu May 21 18:00 America/Vancouver
    end: '2026-05-22T03:00:00.000Z', // 2h
    recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TH;WKST=SU' },
  });
  const out = expandRecurringBookings([b], windowStart, windowEnd);
  expect(out.map((o) => o.start)).toEqual(['2026-06-05T01:00:00.000Z']); // Thu Jun 4 18:00 local
  expect(out[0].end).toBe('2026-06-05T03:00:00.000Z');
});

test('expired recurring series (COUNT exhausted before window) yields nothing', () => {
  const b = booking({
    start: '2026-05-01T17:00:00.000Z',
    end: '2026-05-01T18:00:00.000Z',
    recurrence: { rrule: 'FREQ=DAILY;COUNT=2' },
  });
  expect(expandRecurringBookings([b], windowStart, windowEnd)).toEqual([]);
});

test('after BC went permanent UTC-7 (Nov 2026), occurrences keep their wall-clock time', () => {
  // Weekly Tuesday 10:00, anchored in summer (PDT, -07:00). Node's bundled
  // tzdata would fall back to PST (-08:00) and land it at 11:00 local.
  const b = booking({
    start: '2026-06-02T17:00:00.000Z',
    end: '2026-06-02T18:00:00.000Z',
    recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TU;WKST=SU' },
  });
  const out = expandRecurringBookings(
    [b],
    new Date('2026-11-03T07:00:00.000Z'),
    new Date('2026-11-05T07:00:00.000Z'),
  );
  expect(out.map((o) => o.start)).toEqual(['2026-11-03T17:00:00.000Z']);
});

test('a series anchored in an old PST winter still resolves at its local time', () => {
  // Weekly Tuesday 10:00 anchored Jan 2025 (PST, -08:00 => 18:00Z).
  const b = booking({
    start: '2025-01-07T18:00:00.000Z',
    end: '2025-01-07T19:00:00.000Z',
    recurrence: { rrule: 'FREQ=WEEKLY;BYDAY=TU;WKST=SU' },
  });
  const out = expandRecurringBookings(
    [b],
    new Date('2026-11-03T07:00:00.000Z'),
    new Date('2026-11-05T07:00:00.000Z'),
  );
  expect(out.map((o) => o.start)).toEqual(['2026-11-03T17:00:00.000Z']);
});
