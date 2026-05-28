import type { NextApiRequest, NextApiResponse } from 'next';
import { DateTime } from 'luxon';
import {
  SeparateStartedAndUpcomingEvents,
  TrimExpiredEvents,
} from '../../src/misc/dataProcessing/processEvents';
import { OfficeRnDService } from '../../src/services/OfficeRnDService';

const TIMEZONE = 'America/Vancouver';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const now = DateTime.now().setZone(TIMEZONE);
  const today = now.toISODate()!;
  const tomorrow = now.plus({ days: 1 }).toISODate()!;

  const officeRNDService = new OfficeRnDService();
  const events = await officeRNDService.getEventsWithMeetingRoomsAndHostingTeam(
    today,
    tomorrow,
  );

  const todayEventsSorted = events.sort(function (a, b) {
    return (
      new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
    );
  });
  const eventsToShow = SeparateStartedAndUpcomingEvents(
    TrimExpiredEvents(todayEventsSorted, new Date()),
    new Date(),
  );
  res.status(200).json(eventsToShow);
}
