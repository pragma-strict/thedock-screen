export type OfficeRnDBooking = {
  _id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  timezone: string;
  resource: string;
  company: string;
  member: string | null;
  isCancelled?: boolean;
};

export type AppBooking = {
  _id: string;
  startDateTime: string;
  endDateTime: string;
  timezone: string;
  room: string;
  floor: string;
  summary: string;
  host: string;
};

