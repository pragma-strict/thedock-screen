import type { NextApiRequest, NextApiResponse } from 'next';
import { DateTime } from 'luxon';
import {
  SeparateStartedAndUpcomingEvents,
  SeparateTodayAndTomorrowEvents,
  TrimExpiredEvents,
} from '../../src/misc/dataProcessing/processEvents';
import { OfficeRnDService } from '../../src/services/OfficeRnDService';

const TIMEZONE = 'America/Vancouver';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Window the query to today + tomorrow in the venue's timezone, expressed as
  // absolute UTC instants. OfficeRnD interprets bare date strings as UTC
  // midnight, which (for a UTC-7/8 venue) would shift the window several hours
  // and drop today's evening bookings — so we send full timestamps instead.
  const startOfToday = DateTime.now().setZone(TIMEZONE).startOf('day');
  const endOfWindow = startOfToday.plus({ days: 2 }); // exclusive: start of day after tomorrow

  const officeRNDService = new OfficeRnDService();
  const events = await officeRNDService.getEventsWithMeetingRoomsAndHostingTeam(
    startOfToday.toUTC().toISO()!,
    endOfWindow.toUTC().toISO()!,
  );

  const todayEventsSorted = events.sort(function (a, b) {
    return (
      new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
    );
  });
  const activeEvents = TrimExpiredEvents(todayEventsSorted, new Date());
  const { today: todaysEvents, tomorrow: tomorrowsEvents } =
    SeparateTodayAndTomorrowEvents(activeEvents, new Date(), TIMEZONE);
  const { started, upcoming } = SeparateStartedAndUpcomingEvents(
    todaysEvents,
    new Date(),
  );
  res.status(200).json({ started, upcoming, tomorrow: tomorrowsEvents });
}
