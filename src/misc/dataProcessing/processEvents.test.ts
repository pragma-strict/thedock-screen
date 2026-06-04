import { AppBooking } from '@/src/services/OfficeRnDTypes/Booking';
import {
  SeparateStartedAndUpcomingEvents,
  SeparateTodayAndTomorrowEvents,
  TrimExpiredEvents,
} from './processEvents';

test('Array of 2 events successfully removes 1 expired event from TrimOldEvents', () => {
  expect(
    TrimExpiredEvents(
      [
        { endDateTime: '2024-01-10T12:00:00.000Z', startDateTime: '' },
        { endDateTime: '2024-01-10T19:00:00.000Z', startDateTime: '' },
      ] as AppBooking[],
      new Date('2024-01-10T17:00:00.000Z'),
    ),
  ).toStrictEqual([
    { endDateTime: '2024-01-10T19:00:00.000Z', startDateTime: '' },
  ]);
});

test('Array of 1 active event and 1 upcoming event successfully splits into 2 arrays', () => {
  expect(
    SeparateStartedAndUpcomingEvents(
      [
        { startDateTime: '2024-01-10T11:00:00.000Z', endDateTime: '' },
        { startDateTime: '2024-01-10T14:00:00.000Z', endDateTime: '' },
      ] as AppBooking[],
      new Date('2024-01-10T12:00:00.000Z'),
    ),
  ).toStrictEqual({
    started: [{ startDateTime: '2024-01-10T11:00:00.000Z', endDateTime: '' }],
    upcoming: [{ startDateTime: '2024-01-10T14:00:00.000Z', endDateTime: '' }],
  });
});

test('SeparateTodayAndTomorrowEvents splits by calendar date in the given timezone', () => {
  // "now" is Jan 10 23:00 UTC = Jan 10 15:00 in Vancouver (PST, -08:00).
  const now = new Date('2024-01-10T23:00:00.000Z');
  const result = SeparateTodayAndTomorrowEvents(
    [
      // Jan 10 18:00 Vancouver -> still today
      { startDateTime: '2024-01-11T02:00:00.000Z', endDateTime: '' },
      // Jan 11 09:00 Vancouver -> tomorrow
      { startDateTime: '2024-01-11T17:00:00.000Z', endDateTime: '' },
    ] as AppBooking[],
    now,
    'America/Vancouver',
  );
  expect(result).toStrictEqual({
    today: [{ startDateTime: '2024-01-11T02:00:00.000Z', endDateTime: '' }],
    tomorrow: [{ startDateTime: '2024-01-11T17:00:00.000Z', endDateTime: '' }],
  });
});
