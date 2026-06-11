import { COLOR_USAGES } from '../constant/COLOR_USAGES';
import { AppBooking } from '../services/OfficeRnDTypes/Booking';
import React, { useEffect, useRef } from 'react';

export default function Event({
  event,
  now,
  screenFloor,
}: {
  event: AppBooking;
  now?: Date;
  screenFloor: number;
}) {
  const colors = getFloorColors(event);
  const messageRef = useRef<null | HTMLDivElement>(null);

  // Organization sits top-left; the meeting summary is the title. When there's
  // no summary, the org becomes the title instead (and is dropped from top-left
  // so it isn't shown twice). The room — plus the floor when off-screen — sits
  // bottom-right, e.g. "Boardroom" or "3rd Floor · Boardroom".
  const title = event.summary || event.host;
  const orgLabel = event.summary ? event.host : '';
  const floorLabel = offScreenFloorLabel(event.floor, screenFloor);

  return (
    <div ref={messageRef} className='event' style={{ backgroundColor: colors.background }}>
      <div className='eventDetails'>
        <div className='eventRoomAndTime'>
          <span className='eventOrg' style={{ color: colors.accent }}>{orgLabel}</span>
          {event.coffeeCount > 0 ? (
            <span
              className='eventCoffee'
              role='img'
              aria-label={`Coffee service for ${event.coffeeCount}`}
            >
              ☕ x{event.coffeeCount}
            </span>
          ) : null}
          <EventTimeComponent
            start={new Date(event.startDateTime)}
            end={new Date(event.endDateTime)}
            now={now}
          />
        </div>
        <div className='eventTitleRow'>
          <div className='eventTitle kollectif'>{title}</div>
          {event.room ? (
            <span className='eventRoom'>
              {floorLabel ? (
                <span style={{ color: colors.accent, fontWeight: 400 }}>
                  {floorLabel} ·{' '}
                </span>
              ) : null}
              {event.room}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Returns 1 or 3 from a floor name like "Floor 1" / "3rd Floor" (matching the
// convention getEventStyle already relies on), or undefined if unrecognized.
const floorNumberOf = (floorName: string): number | undefined => {
  if (floorName?.includes('3')) return 3;
  if (floorName?.includes('1')) return 1;
  return undefined;
};

// The event's floor name, shown only when it differs from the screen's own
// floor — a same-floor event needs no label since that floor is assumed.
const offScreenFloorLabel = (
  eventFloor: string,
  screenFloor: number,
): string | undefined => {
  const eventNumber = floorNumberOf(eventFloor);
  if (eventNumber === undefined || eventNumber === screenFloor) return undefined;
  return eventFloor;
};

const isBookingAllDay = (start: Date, end: Date): boolean => {
  const dayInMilliseconds = 1000 * 60 * 60 * 24;
  return end.valueOf() - start.valueOf() == dayInMilliseconds;
};

function EventTimeComponent({ start, end, now }: { start: Date; end: Date; now?: Date; }) {
  if (isBookingAllDay(start, end)) {
    return <div className='eventTime'>All Day</div>;
  }

  // For events already underway, show time remaining instead of the full range.
  if (now) {
    return <div className='eventTime'>{formatRemaining(end, now)}</div>;
  }

  // Drop the redundant meridiem from the start when both sides share it, so
  // "1:00 PM - 2:00 PM" reads as "1:00 - 2:00 PM". Otherwise keep both.
  const startStr = formatTime(start);
  const endStr = formatTime(end);
  const startDisplay =
    meridiemOf(startStr) === meridiemOf(endStr)
      ? stripMeridiem(startStr)
      : startStr;
  return (
    <div className='eventTime'>
      <span className='noWrap'>{startDisplay}</span> {' - '}
      <span className='noWrap'>{endStr}</span>
    </div>
  );
}

// More than an hour left reads as an end time ("Until 3:00 PM"); the final
// stretch counts down ("45 mins") to draw attention to rooms freeing up soon.
const formatRemaining = (end: Date, now: Date) => {
  const minutesLeft = Math.ceil((end.valueOf() - now.valueOf()) / (1000 * 60));
  if (minutesLeft >= 60) {
    return <span className='noWrap'>Until {formatTime(end)}</span>;
  }
  const mins = Math.max(minutesLeft, 1);
  return (
    <span className='noWrap'>
      For {mins} {mins === 1 ? 'min' : 'mins'}
    </span>
  );
};

const formatTime = (date: Date | number) => {
  return new Intl.DateTimeFormat('en-US', {
    timeStyle: 'short',
  }).format(date);
};

// en-US short time always ends in "AM"/"PM" (e.g. "1:00 PM").
const meridiemOf = (time: string) => time.match(/(AM|PM)$/i)?.[0];
const stripMeridiem = (time: string) => time.replace(/\s*(AM|PM)$/i, '');

// Card background + matching accent (a lighter tint) for an event's floor.
// Defaults to Floor 1's colors when the floor is missing or unrecognized.
const getFloorColors = (event: AppBooking) => {
  if (floorNumberOf(event.floor) === 3) {
    return { background: COLOR_USAGES.FLOOR_3, accent: COLOR_USAGES.FLOOR_3_ALT };
  }
  return { background: COLOR_USAGES.FLOOR_1, accent: COLOR_USAGES.FLOOR_1_ALT };
};

