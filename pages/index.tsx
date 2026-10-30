import Event from '@/src/components/event';
import { isMidnightMode } from '@/src/helpers/isMidnightMode';
import { sortEventsByProximityToNow } from '@/src/helpers/sortEventsByProximityToNow';
import { sortBookingByTimeAsc } from '@/src/helpers/sortEventsByStartTimeAsc';
import {
  SeparateStartedAndUpcomingEvents,
  TrimExpiredEvents,
} from '@/src/misc/dataProcessing/processEvents';
import { AppBooking } from '@/src/services/OfficeRnDTypes/Booking';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import React, { PropsWithChildren, useState, useEffect } from 'react';

// Screen refresh is decoupled from data fetching: the clock ticks every second
// so the view re-derives which events are finished/started/upcoming on the fly,
// while the (relatively expensive) API fetch happens only every few minutes.
const SCREEN_UPDATE_INTERVAL = 1000; // 1 second — keeps clock + countdowns live
const DATA_FETCH_INTERVAL = 300000; // 5 minutes

// The midnight seascape uses WebGL (three.js), so it's client-only and its code
// is only downloaded once midnight mode actually turns on.
const MidnightSeascape = dynamic(
  () => import('@/src/components/MidnightSeascape'),
  { ssr: false },
);

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

  // Which floor is this screen on? Set per kiosk via the URL (e.g. /?floor=1).
  // Events on the same floor show no floor label; events elsewhere show
  // "Upstairs"/"Downstairs" relative to this value.
  const { floor, midnight } = useRouter().query;
  const screenFloor = parseScreenFloor(floor);

  // Midnight mode swaps the black background for an animated seascape between
  // 00:00 and 06:00. `?midnight=1` forces it on for previewing during the day.
  const midnightMode = midnight === '1' || isMidnightMode(currentTime);
  // The seascape's floating 3D logo replaces the flat one once it has loaded;
  // until then (or if it fails) the flat white logo stays put.
  const [floatingLogoReady, setFloatingLogoReady] = useState(false);
  useEffect(() => {
    if (!midnightMode) setFloatingLogoReady(false);
  }, [midnightMode]);

  // Raw buckets from the API: today's events (regardless of started/finished)
  // and tomorrow's. The started/upcoming/finished split is derived below from
  // the live clock, not baked in here, so it stays current between fetches.
  const [eventData, setEventData] = useState({
    today: Array<AppBooking>(),
    tomorrow: Array<AppBooking>(),
  });

  const controlledFetchedEvents = function () {
    // Only fetch during operating hours (5:00–22:59).
    // `?fetchAtNight=1` bypasses the hours check so midnight mode can be
    // previewed with real bookings. Read from the URL at call time because the
    // router's query is still empty on the first render.
    const fetchAtNight =
      new URLSearchParams(window.location.search).get('fetchAtNight') === '1';
    const nowHour = new Date().getHours();
    if (!fetchAtNight && (nowHour > 22 || nowHour < 5)) {
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
      title: 'Now',
      events: sortEventsByProximityToNow(started),
      // Render these events as a live countdown of remaining time.
      now: currentTime,
    },
    { title: 'Later today', events: sortBookingByTimeAsc(upcoming) },
    { title: 'Tomorrow', events: sortBookingByTimeAsc(eventData.tomorrow) },
  ].filter((section) => section.events.length > 0);

  return (
    <div className='event_page'>
      {midnightMode && (
        <MidnightSeascape onLogoReady={() => setFloatingLogoReady(true)} />
      )}
      <div className='child_section left_section no-scrollbar'>
        {sections.map((section) => (
          <Section
            key={section.title}
            title={section.title}
            events={section.events}
            now={section.now}
            screenFloor={screenFloor}
            translucent={midnightMode}
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
          {midnightMode && <span className='midnight-mode-tag'>Midnight mode</span>}
        </div>
        <img
          className={
            midnightMode
              ? floatingLogoReady
                ? 'logo logo--hidden'
                : 'logo logo--midnight'
              : 'logo'
          }
          src={midnightMode ? 'theDockLogoWhite.png' : 'theDockLogoSquareColors.png'}
        />
      </div>
    </div>
  );
}

const Section = ({
  title,
  events,
  now,
  screenFloor,
  translucent,
}: {
  title: string;
  events: AppBooking[];
  now?: Date;
  screenFloor: number;
  translucent?: boolean;
}) => {
  return (
    <section className='event_section'>
      <SectionTitle>{title}</SectionTitle>
      <div className='event_section__list'>
        {events.map((event) => (
          <Event
            event={event}
            now={now}
            screenFloor={screenFloor}
            translucent={translucent}
            key={event._id}
          />
        ))}
      </div>
    </section>
  );
};

const SectionTitle = ({ children }: PropsWithChildren<{}>) => {
  return <div className='event_section__title'>{children}</div>;
};

// Reads the screen's floor from the ?floor= query param, defaulting to the
// first floor when absent or non-numeric (e.g. an unconfigured screen).
const DEFAULT_SCREEN_FLOOR = 1;
const parseScreenFloor = (floor: string | string[] | undefined): number => {
  const value = Array.isArray(floor) ? floor[0] : floor;
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : DEFAULT_SCREEN_FLOOR;
};