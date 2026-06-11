import Event from '@/src/components/event';
import { sortEventsByProximityToNow } from '@/src/helpers/sortEventsByProximityToNow';
import { sortBookingByTimeAsc } from '@/src/helpers/sortEventsByStartTimeAsc';
import {
  SeparateStartedAndUpcomingEvents,
  TrimExpiredEvents,
} from '@/src/misc/dataProcessing/processEvents';
import { AppBooking } from '@/src/services/OfficeRnDTypes/Booking';
import React, { PropsWithChildren, useState, useEffect } from 'react';

// Screen refresh is decoupled from data fetching: the clock ticks every second
// so the view re-derives which events are finished/started/upcoming on the fly,
// while the (relatively expensive) API fetch happens only every few minutes.
const SCREEN_UPDATE_INTERVAL = 1000; // 1 second — keeps clock + countdowns live
const DATA_FETCH_INTERVAL = 300000; // 5 minutes

export default function Home() {
  const [currentTime, setRealTime] = useState(new Date());
  useEffect(() => {
    const timeIntervalId = setInterval(function () {
      setRealTime(new Date());
    }, SCREEN_UPDATE_INTERVAL);
    return () => {
      clearInterval(timeIntervalId);
    };
  }, []);

  // Raw buckets from the API: today's events (regardless of started/finished)
  // and tomorrow's. The started/upcoming/finished split is derived below from
  // the live clock, not baked in here, so it stays current between fetches.
  const [eventData, setEventData] = useState({
    today: Array<AppBooking>(),
    tomorrow: Array<AppBooking>(),
  });

  const controlledFetchedEvents = function () {
    // Only fetch during operating hours (5:00–22:59).
    const nowHour = new Date().getHours();
    if (nowHour > 22 || nowHour < 5) {
      return null;
    }
    fetch('/api/getEvents')
      .then((res) => {
        if (!res.ok) throw new Error('Error Status: ' + res.status);
        else return res.json();
      })
      .then((apiEventData) => {
        setEventData({
          today: apiEventData.today ?? [],
          tomorrow: apiEventData.tomorrow ?? [],
        });
      })
      .catch((e) => {
        console.error('Error fetching events');
        console.error(e);
        return;
      });
  };

  useEffect(() => {
    controlledFetchedEvents(); // First time to fire off instantly
    const intervalId = setInterval(() => {
      controlledFetchedEvents();
    }, DATA_FETCH_INTERVAL);
    return () => clearInterval(intervalId);
  }, []);

  // Derive the live view from the current clock: drop finished events, then
  // split the rest into already-started vs. still-upcoming. Re-runs every tick.
  const activeToday = TrimExpiredEvents(eventData.today, currentTime);
  const { started, upcoming } = SeparateStartedAndUpcomingEvents(
    activeToday,
    currentTime,
  );

  // Each section renders only when it has events, so the layout flexes to
  // whatever is actually happening. Adding a section is just another entry here.
  const sections = [
    {
      title: 'Happening right now',
      events: sortEventsByProximityToNow(started),
      // Render these events as a live countdown of remaining time.
      now: currentTime,
    },
    { title: 'Later today', events: sortBookingByTimeAsc(upcoming) },
    { title: 'Tomorrow', events: sortBookingByTimeAsc(eventData.tomorrow) },
  ].filter((section) => section.events.length > 0);

  return (
    <div className='event_page'>
      <div className='child_section left_section no-scrollbar'>
        {sections.map((section) => (
          <Section
            key={section.title}
            title={section.title}
            events={section.events}
            now={section.now}
          />
        ))}
      </div>
      <div className='child_section right_section'>
        <div className='display-time'>
          <span id='timeValue'>
            {Intl.DateTimeFormat('en-US', {
              minute: 'numeric',
              hour: 'numeric',
            }).format(currentTime)}
          </span>
          <span>
            {Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            }).format(currentTime)}
          </span>
        </div>
        <img className='logo' src='theDockLogoSquareColors.png' />
      </div>
    </div>
  );
}

const Section = ({
  title,
  events,
  now,
}: {
  title: string;
  events: AppBooking[];
  now?: Date;
}) => {
  return (
    <section className='event_section'>
      <SectionTitle>{title}</SectionTitle>
      <div className='event_section__list'>
        {events.map((event) => (
          <Event event={event} now={now} key={event._id} />
        ))}
      </div>
    </section>
  );
};

const SectionTitle = ({ children }: PropsWithChildren<{}>) => {
  return <div className='event_section__title'>{children}</div>;
};