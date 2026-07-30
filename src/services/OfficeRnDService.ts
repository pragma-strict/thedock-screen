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

// Rate-limit handling: OfficeRnD returns 429 when we fan out too many requests
// at once. We cap how many per-booking lookups (members/companies) run
// concurrently, and retry any 429 a few times with backoff.
const MEMBER_COMPANY_CONCURRENCY = 5;
// OfficeRnD's `$in` filter accepts at most 50 values per request.
const MAX_IN_FILTER_VALUES = 50;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BACKOFF_MS = 1000;

// OAuth token lifetime handling for the reused service instance. Refresh a
// little before the token actually expires; if the grant response omits
// `expires_in`, assume a conservative lifetime.
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_SKEW_SECONDS = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Distinct, non-empty values, preserving first-seen order.
const uniqueTruthy = <T>(values: (T | null | undefined)[]): T[] =>
  Array.from(new Set(values.filter((value): value is T => Boolean(value))));

// Split an array into consecutive chunks of at most `size` elements.
const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

// Run `task` over `items` with at most `limit` in flight at a time, returning
// results in input order (like Promise.all, but bounded).
const mapWithConcurrency = async <T, R>(
  items: T[],
  task: (item: T) => Promise<R>,
  limit = MEMBER_COMPANY_CONCURRENCY,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
};

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

// ...and like this when the Owl Meeting Pro add-on is included.
const OWL_PLAN_NAME_PATTERN = /owl/i;

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
  // Epoch ms at which the cached token should be considered expired. The service
  // is reused across requests, so a token can't live forever — we refresh it
  // once it (nearly) expires, based on the grant's `expires_in`.
  private tokenExpiresAt = 0;

  aggregator = new OfficeRnDDataAggregator();

  private authenticate = async () => {
    if (this.access_token && Date.now() < this.tokenExpiresAt) {
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
    const data: { access_token: string; expires_in?: number } =
      await response.json();
    this.access_token = data.access_token;
    // Refresh a bit before the real expiry to avoid using a just-expired token;
    // fall back to a conservative lifetime if the grant omits `expires_in`.
    const lifetimeSeconds = data.expires_in ?? DEFAULT_TOKEN_LIFETIME_SECONDS;
    this.tokenExpiresAt =
      Date.now() + Math.max(0, lifetimeSeconds - TOKEN_REFRESH_SKEW_SECONDS) * 1000;
    return this.access_token;
  };

  // Retry a rate-limited (429) request a few times, honouring the server's
  // `Retry-After` header when present and otherwise backing off linearly.
  private fetchWithToken = async <T extends {}>(
    url: string,
    retriesLeft = MAX_RATE_LIMIT_RETRIES,
  ): Promise<T> => {
    const token = await this.authenticate();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + token,
      },
    });
    if (response.status === 429 && retriesLeft > 0) {
      const attempt = MAX_RATE_LIMIT_RETRIES - retriesLeft + 1;
      const retryAfterSeconds = Number(response.headers.get('Retry-After'));
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : attempt * RATE_LIMIT_BACKOFF_MS;
      await sleep(delayMs);
      return this.fetchWithToken<T>(url, retriesLeft - 1);
    }
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
    const owlPlanId = await this.getOwlPlanId();
    return this.aggregator.combineOfficeRnDDataIntoAppBookings(
      floors,
      meetingRooms,
      occurrences,
      companies,
      members,
      coffeePlanId,
      owlPlanId,
    );
  };

  // The id of the "Coffee/Tea Service" add-on plan.
  private getCoffeePlanId = () =>
    this.resolveServicePlanId(COFFEE_PLAN_NAME_PATTERN);

  // The id of the "Owl Meeting Pro" add-on plan.
  private getOwlPlanId = () => this.resolveServicePlanId(OWL_PLAN_NAME_PATTERN);

  // Resolves an add-on plan's id by matching its name, so we don't hardcode
  // database ids. Reads the cached plans catalog (static, ~80 plans / 2 pages).
  // Returns null — and the indicator is simply skipped — if the plans scope is
  // missing or the lookup fails, rather than breaking the whole display.
  private resolveServicePlanId = async (
    namePattern: RegExp,
  ): Promise<string | null> => {
    try {
      const plans = await this.getPlans();
      const plan = plans.find((plan) => namePattern.test(plan.name ?? ''));
      return plan?._id ?? null;
    } catch {
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
    const companyIds = uniqueTruthy(bookings.map((booking) => booking.company));
    return this.fetchByIds<OfficeRnDCompany>('companies', companyIds);
  };

  private getMembers = async (bookings: OfficeRnDBooking[]) => {
    const memberIds = uniqueTruthy(bookings.map((booking) => booking.member));
    return this.fetchByIds<OfficeRnDMember>('members', memberIds);
  };

  // Fetch many records by id in as few requests as possible: one list query per
  // batch of up to 50 ids via the `_id[$in]` filter, instead of one request per
  // id. This is what keeps us under OfficeRnD's rate limit on busy days. Ids are
  // sorted so the request URL (and thus the cache key) is stable across polls.
  private fetchByIds = async <T extends {}>(
    endpoint: string,
    ids: string[],
  ): Promise<T[]> => {
    const batches = chunk([...ids].sort(), MAX_IN_FILTER_VALUES);
    const pages = await mapWithConcurrency(batches, (batch) => {
      const qs =
        `_id[$in]=${encodeURIComponent(batch.join(','))}` +
        `&$limit=${MAX_IN_FILTER_VALUES}`;
      return this.fetchWithTokenAndCache<V2ListResponse<T>>(
        `${this.BASE_API_URL}/${endpoint}?${qs}`,
      );
    });
    return pages.flatMap((page) => page.results);
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
