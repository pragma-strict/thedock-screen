import { COLOR_USAGES } from '../constant/COLOR_USAGES';
import { AppBooking } from '../services/OfficeRnDTypes/Booking';
import React, { useEffect, useRef } from 'react';

export default function Event({ event, now }: { event: AppBooking; now?: Date; }) {
  const style = getEventStyle(event);
  const messageRef = useRef<null | HTMLDivElement>(null);

  const dataToShow = event.summary
    ? {
      title: event.summary,
      description: event.host,
    }
    : {
      title: event.host,
      description: event.summary,
    };
  return (
    <div ref={messageRef} className='event' style={style}>
      <div className='eventDetails'>
        <div className='eventRoomAndTime'>
          <span className='eventRoom'>
            {event.floor} - {event.room}
          </span>
          <EventTimeComponent
            start={new Date(event.startDateTime)}
            end={new Date(event.endDateTime)}
            now={now}
          />
        </div>
        <div className='eventTitle kollectif'>{dataToShow.title}</div>
        {dataToShow.description ? (
          <div className='eventDescription'>{dataToShow.description}</div>
        ) : ''}
      </div>
    </div>
  );
}

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

const getEventStyle = (event: AppBooking) => {
  // Default to Floor 1 if nothing is found
  if (event.floor === undefined) {
    return { backgroundColor: COLOR_USAGES.FLOOR_1 };
  }
  if (event.floor.includes('1')) {
    return { backgroundColor: COLOR_USAGES.FLOOR_1 };
  }
  if (event.floor.includes('3')) {
    return { backgroundColor: COLOR_USAGES.FLOOR_3 };
  }
};

