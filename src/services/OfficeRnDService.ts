import { OfficeRnDDataAggregator } from './OfficeRnDDataAggregator';
import { expandRecurringBookings } from './expandRecurringBookings';
import { AppBooking, OfficeRnDBooking } from './OfficeRnDTypes/Booking';
import { OfficeRnDFloor } from './OfficeRnDTypes/Floor';
import { OfficeRnDMeetingRoom } from './OfficeRnDTypes/MeetingRoom';
import { OfficeRnDMember } from './OfficeRnDTypes/Member';
import { OfficeRnDCompany } from './OfficeRnDTypes/Company';
import { OfficeRnDPlan } from './OfficeRnDTypes/Plan';

const ONE_DAY_IN_MS = 1000 * 60 * 60 * 24; // 1 day
const DEFAULT_CACHE_TIME_IN_MS = 3 * ONE_DAY_IN_MS; // 3 days

const DEFAULT_SCOPE = [
  'flex.space.bookings.read',
  'flex.space.resources.read',
  'flex.space.floors.read',
  'flex.community.members.read',
  'flex.community.companies.read',
  // Plans cover add-on services (e.g. the "Coffee/Tea Service" booking extra);
  // we read them to map a booking's extra ids to a recognizable name.
  'flex.billing.plans.read',
].join(' ');

// Booking extras reference a plan named like this when coffee is included.
const COFFEE_PLAN_NAME_PATTERN = /coffee/i;

// v2 list endpoints wrap results in { results: T[] }
type V2ListResponse<T> = {
  results: T[];
  cursorNext?: string;
  cursorPrev?: string;
  rangeStart?: number;
  rangeEnd?: number;
};

export class OfficeRnDService {
  BASE_API_URL = 'https://app.officernd.com/api/v2/organizations/thedock';
  access_token = '';

  aggregator = new OfficeRnDDataAggregator();

  private authenticate = async () => {
    if (this.access_token) {
      return this.access_token;
    }
    const response = await fetch(
      'https://identity.officernd.com/oauth/token',
      AuthOptions,
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OfficeRnD auth failed (${response.status}): ${body}`);
    }
    const data: { access_token: string } = await response.json();
    this.access_token = data.access_token;
    return this.access_token;
  };

  private fetchWithToken = async <T extends {}>(url: string) => {
    const token = await this.authenticate();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    if (!response.ok) {
      throw new Error(
        `OfficeRnD API error (${response.status}): ${response.statusText} — ${url}`
      );
    }
    return (await response.json()) as T;
  };

  cachedData: Record<string, { data: any; cachingTimestamp: number }> = {};
  private fetchWithTokenAndCache = async <T extends {}>(
    url: string,
    defaultCacheDuration = DEFAULT_CACHE_TIME_IN_MS,
  ) => {
    if (this.cachedData[url]) {
      if (
        Date.now() - this.cachedData[url].cachingTimestamp <
        defaultCacheDuration
      ) {
        return this.cachedData[url].data as T;
      }
    }
    const data = await this.fetchWithToken<T>(url);
    this.cachedData[url] = { data, cachingTimestamp: Date.now() };
    return data;
  };

  // Fetch every booking series that overlaps the window [dateStart, dateEnd)
  // (ISO instants): the series starts before the window ends AND ends at/after
  // the window starts. This catches both one-off bookings and recurring series
  // anchored earlier (e.g. a weekly meeting that still recurs this week) —
  // recurrence is then expanded into concrete occurrences downstream.
  //
  // Bookings can only be filtered by `seriesStart`/`seriesEnd`, not by
  // occurrence `start`/`end` (the API rejects those). Results are paged 50 at a
  // time, so we follow `cursorNext` until exhausted.
  private getEvents = async (dateStart: string, dateEnd: string) => {
    const results: OfficeRnDBooking[] = [];
    let cursor: string | undefined;
    do {
      const qs =
        `seriesStart[$lt]=${encodeURIComponent(dateEnd)}` +
        `&seriesEnd[$gte]=${encodeURIComponent(dateStart)}` +
        `&$limit=50` +
        (cursor ? `&$cursorNext=${encodeURIComponent(cursor)}` : '');
      const data = await this.fetchWithToken<V2ListResponse<OfficeRnDBooking>>(
        `${this.BASE_API_URL}/bookings?${qs}`,
      );
      results.push(...data.results);
      cursor = data.cursorNext;
    } while (cursor);
    return results;
  };

  // The date window is enforced by the `seriesStart` query and the today/
  // tomorrow split downstream, so here we only need to drop cancelled bookings.
  private filterCancelledEvents = (events: OfficeRnDBooking[]) => {
    return events.filter((event) => !event.isCancelled);
  };

  getEventsWithMeetingRoomsAndHostingTeam = async (
    dateStart: string,
    dateEnd: string,
  ): Promise<AppBooking[]> => {
    const floors = await this.getFloors();
    const meetingRooms = await this.getMeetingRooms();
    const allEvents = await this.getEvents(dateStart, dateEnd);
    const events = this.filterCancelledEvents(allEvents);
    // Expand recurring series into concrete occurrences within the window, and
    // drop one-off bookings that fall outside it (the overlap query can return
    // series whose anchor occurrence is before the window).
    const occurrences = expandRecurringBookings(
      events,
      new Date(dateStart),
      new Date(dateEnd),
    );
    // Companies/members are shared by all occurrences of a series, so resolve
    // them from the (deduplicated) anchor rows rather than every occurrence.
    const companies = await this.getCompanies(events);
    const members = await this.getMembers(events);
    const coffeePlanId = await this.getCoffeePlanId();
    return this.aggregator.combineOfficeRnDDataIntoAppBookings(
      floors,
      meetingRooms,
      occurrences,
      companies,
      members,
      coffeePlanId,
    );
  };

  // The id of the "Coffee/Tea Service" add-on plan, resolved by name so we don't
  // hardcode a database id. Cached (static catalog, ~80 plans / 2 pages).
  private getCoffeePlanId = async (): Promise<string | null> => {
    try {
      const plans = await this.getPlans();
      const coffee = plans.find((plan) =>
        COFFEE_PLAN_NAME_PATTERN.test(plan.name ?? ''),
      );
      return coffee?._id ?? null;
    } catch {
      // A missing plans scope shouldn't break the whole display — just skip the
      // coffee indicator.
      return null;
    }
  };

  private getPlans = async (): Promise<OfficeRnDPlan[]> => {
    const results: OfficeRnDPlan[] = [];
    let cursor: string | undefined;
    do {
      const qs = `$limit=50` + (cursor ? `&$cursorNext=${encodeURIComponent(cursor)}` : '');
      const data = await this.fetchWithTokenAndCache<V2ListResponse<OfficeRnDPlan>>(
        `${this.BASE_API_URL}/plans?${qs}`,
      );
      results.push(...data.results);
      cursor = data.cursorNext;
    } while (cursor);
    return results;
  };

  private getMeetingRooms = async () => {
    const data = await this.fetchWithTokenAndCache<V2ListResponse<OfficeRnDMeetingRoom>>(
      `${this.BASE_API_URL}/resources?type=meeting_room`,
    );
    return data.results;
  };

  private getFloors = async () => {
    const data = await this.fetchWithTokenAndCache<V2ListResponse<OfficeRnDFloor>>(
      `${this.BASE_API_URL}/floors`,
    );
    return data.results;
  };

  private getCompanies = async (bookings: OfficeRnDBooking[]) => {
    const companyPromises = bookings
      .filter((booking) => booking.company)
      .map<Promise<OfficeRnDCompany>>((booking) => {
        return this.getCompany(booking);
      });
    return Promise.all(companyPromises);
  };

  private getCompany = (booking: OfficeRnDBooking) => {
    return this.fetchWithTokenAndCache<OfficeRnDCompany>(
      `${this.BASE_API_URL}/companies/${booking.company}`,
    );
  };

  private getMembers = async (bookings: OfficeRnDBooking[]) => {
    const memberPromises = bookings
      .filter((booking) => booking.member)
      .map<Promise<OfficeRnDMember>>((booking) => {
        return this.getMember(booking);
      });
    return Promise.all(memberPromises);
  };

  private getMember = async (
    booking: OfficeRnDBooking,
  ): Promise<OfficeRnDMember> => {
    return this.fetchWithTokenAndCache<OfficeRnDMember>(
      `${this.BASE_API_URL}/members/${booking.member}`,
    );
  };
}

const AuthOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    client_id: process.env.OFFICERND_CLIENT_ID as string,
    client_secret: process.env.OFFICERND_CLIENT_SECRET as string,
    grant_type: 'client_credentials',
    scope: process.env.OFFICERND_SCOPE || DEFAULT_SCOPE,
  }),
};
