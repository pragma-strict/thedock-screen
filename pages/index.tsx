import Event from '@/src/components/event';
import { sortEventsByProximityToNow } from '@/src/helpers/sortEventsByProximityToNow';
import { sortBookingByTimeAsc } from '@/src/helpers/sortEventsByStartTimeAsc';
import { AppBooking } from '@/src/services/OfficeRnDTypes/Booking';
import React, { PropsWithChildren, useState, useEffect } from 'react';
const TIME_TO_REFRESH = 3000; // 3 seconds refresh
const TIME_TO_GET_REQUEST = 240000; // 4 minutes refershing token

export default function Home() {
  const [currentTime, setRealTime] = useState(new Date());
  useEffect(() => {
    const timeIntervalId = setInterval(function () {
      setRealTime(new Date());
    }, TIME_TO_REFRESH);
    return () => {
      clearInterval(timeIntervalId);
    };
  }, []);

  const [eventData, setEventData] = useState({
    started: Array<AppBooking>(),
    upcoming: Array<AppBooking>(),
    tomorrow: Array<AppBooking>(),
  });
  const currentTimeEvent = new Date();
  // Only fetching events during 5 - 22

  const controlledFetchedEvents = function () {
    if (currentTimeEvent.getHours() > 22 || currentTimeEvent.getHours() < 5) {
      return null;
    }
    fetch('/api/getEvents')
      .then((res) => {
        if (!res.ok) throw new Error('Error Status: ' + res.status);
        else return res.json();
      })
      .then((apiEventData) => {
        setEventData({
          started: apiEventData.started ?? [],
          upcoming: apiEventData.upcoming ?? [],
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
    }, TIME_TO_GET_REQUEST);
    return () => clearInterval(intervalId);
  }, []);

  if (!eventData) {
    // If encounter event data problems --> stop rendering
    return null;
  }

  // Each section renders only when it has events, so the layout flexes to
  // whatever is actually happening. Adding a section is just another entry here.
  const sections = [
    {
      title: 'Happening right now',
      events: sortEventsByProximityToNow(eventData.started),
    },
    { title: 'Later today', events: sortBookingByTimeAsc(eventData.upcoming) },
    { title: 'Tomorrow', events: sortBookingByTimeAsc(eventData.tomorrow) },
  ].filter((section) => section.events.length > 0);

  return (
    <div className='event_page'>
      <div className='child_section left_section no-scrollbar'>
        {sections.map((section) => (
          <Section key={section.title} title={section.title} events={section.events} />
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

const Section = ({ title, events }: { title: string; events: AppBooking[]; }) => {
  return (
    <section className='event_section'>
      <SectionTitle>{title}</SectionTitle>
      <div className='event_section__list'>
        {events.map((event) => (
          <Event event={event} key={event._id} />
        ))}
      </div>
    </section>
  );
};

const SectionTitle = ({ children }: PropsWithChildren<{}>) => {
  return <div className='event_section__title'>{children}</div>;
};