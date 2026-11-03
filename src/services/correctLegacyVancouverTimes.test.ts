import { OfficeRnDBooking } from './OfficeRnDTypes/Booking';
import { correctLegacyVancouverTimes } from './correctLegacyVancouverTimes';
import { expandRecurringBookings } from './expandRecurringBookings';

const booking = (b: Partial<OfficeRnDBooking>): OfficeRnDBooking =>
  ({ _id: 'id', title: 't', timezone: 'America/Vancouver', ...b } as OfficeRnDBooking);

// Real cases (Nov 2026), comparing OfficeRnD's calendar to its API.
test.each([
  // Dometic Marine: calendar 1:00–4:00 PM
  ['2026-11-03T21:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-03T20:00:00.000Z', '2026-11-03T23:00:00.000Z'],
  // Krystle Hadlow: calendar 8:00 AM–5:00 PM
  ['2026-11-18T16:00:00.000Z', '2026-11-19T01:00:00.000Z', '2026-11-18T15:00:00.000Z', '2026-11-19T00:00:00.000Z'],
])('America/Vancouver booking %s is moved back to its intended time', (start, end, wantStart, wantEnd) => {
  const [out] = correctLegacyVancouverTimes([booking({ start, end })]);
  expect([out.start, out.end]).toEqual([wantStart, wantEnd]);
});

test('Canada/Yukon bookings are stored correctly and left alone', () => {
  const b = booking({ timezone: 'Canada/Yukon', start: '2026-11-03T19:30:00.000Z', end: '2026-11-03T20:30:00.000Z' });
  expect(correctLegacyVancouverTimes([b])).toEqual([b]);
});

test('dates before the cutover are untouched', () => {
  const b = booking({ start: '2026-10-20T17:00:00.000Z', end: '2026-10-20T18:00:00.000Z' });
  expect(correctLegacyVancouverTimes([b])[0]).toEqual(b);
});

test('next summer, when the old rules would be on PDT anyway, is untouched', () => {
  const b = booking({ start: '2027-07-06T17:00:00.000Z', end: '2027-07-06T18:00:00.000Z' });
  expect(correctLegacyVancouverTimes([b])[0]).toEqual(b);
});

test('recurring series keeps its wall-clock time on every occurrence', () => {
  // Chartwork course: calendar 8:00 AM–5:00 PM, daily x3 from Nov 3.
  const b = booking({
    start: '2026-11-03T16:00:00.000Z',
    end: '2026-11-04T01:00:00.000Z',
    recurrence: { rrule: 'FREQ=DAILY;COUNT=3' },
  });
  const out = expandRecurringBookings(
    correctLegacyVancouverTimes([b]),
    new Date('2026-11-03T07:00:00.000Z'),
    new Date('2026-11-05T07:00:00.000Z'),
  );
  expect(out.map((o) => [o.start, o.end])).toEqual([
    ['2026-11-03T15:00:00.000Z', '2026-11-04T00:00:00.000Z'],
    ['2026-11-04T15:00:00.000Z', '2026-11-05T00:00:00.000Z'],
  ]);
});
