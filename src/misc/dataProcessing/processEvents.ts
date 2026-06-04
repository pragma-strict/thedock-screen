import { AppBooking } from "@/src/services/OfficeRnDTypes/Booking";
import { DateTime } from "luxon";

export function TrimExpiredEvents(events: Array<AppBooking>, dateTimeToCompare: Date) {
    return events.filter((event) => {
        const eventEndTime = new Date(event.endDateTime);
        return eventEndTime > dateTimeToCompare;
    })
}

interface HasStartDateTime {
    startDateTime: string;
}

export function SeparateStartedAndUpcomingEvents<T extends HasStartDateTime>(events: Array<T>, dateTimeToCompare: Date) {
    let out = {started: Array<T>(), upcoming: Array<T>()};
    for(let i=0; i < Object.keys(events).length; i++) {
        const item = events[i];
        if (new Date(item.startDateTime) < dateTimeToCompare) {
            out.started.push(item)
        } else {
            out.upcoming.push(item)
        }
    }
    return out
}

// Splits events into those happening today vs. on a later day, comparing
// calendar dates in the given timezone (so the split is correct near midnight
// regardless of the server's local time).
export function SeparateTodayAndTomorrowEvents<T extends HasStartDateTime>(
    events: Array<T>,
    now: Date,
    timezone: string,
) {
    const todayDate = DateTime.fromJSDate(now).setZone(timezone).toISODate();
    const out = { today: Array<T>(), tomorrow: Array<T>() };
    for (const event of events) {
        const eventDate = DateTime.fromISO(event.startDateTime)
            .setZone(timezone)
            .toISODate();
        if (eventDate === todayDate) {
            out.today.push(event);
        } else {
            out.tomorrow.push(event);
        }
    }
    return out;
}
