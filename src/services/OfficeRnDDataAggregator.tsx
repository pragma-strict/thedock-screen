import { OfficeRnDBooking, AppBooking } from "./OfficeRnDTypes/Booking";
import { OfficeRnDCompany } from "./OfficeRnDTypes/Company";
import { OfficeRnDMeetingRoom } from "./OfficeRnDTypes/MeetingRoom";
import { OfficeRnDFloor } from "./OfficeRnDTypes/Floor";
import { keyBy } from "../helpers/keyBy";
import { OfficeRnDMember } from "./OfficeRnDTypes/Member";

export class OfficeRnDDataAggregator {
  combineOfficeRnDDataIntoAppBookings = (
    floors: OfficeRnDFloor[],
    meetingRooms: OfficeRnDMeetingRoom[],
    events: OfficeRnDBooking[],
    companies: OfficeRnDCompany[],
    members: OfficeRnDMember[],
    coffeePlanId: string | null = null,
  ): AppBooking[] => {
    const floorsById = keyBy(floors, '_id');
    const companiesById = keyBy(companies, '_id');
    const meetingRoomsById = this.combineMeetingRoomsAndFloors(
      floorsById, meetingRooms
    );
    const membersById = keyBy(members, '_id');
    const eventsWithMeetingRooms = events.map((event) => {
      const meetingRoom = meetingRoomsById[event.resource];
      const company = companiesById[event.company];
      const member = event.member ? membersById[event.member] : undefined;
      return {
        _id: event._id,
        summary: event.title,
        endDateTime: event.end,
        startDateTime: event.start,
        timezone: event.timezone,
        room: meetingRoom?.name || '',
        floor: meetingRoom?.floor || '',
        host: company?.name || member?.name || '',
        coffeeCount: coffeePlanId
          ? (event.extras ?? []).find((extra) => extra._id === coffeePlanId)
              ?.count ?? 0
          : 0,
      } as AppBooking;
    });
    return eventsWithMeetingRooms;
  };

  combineMeetingRoomsAndFloors = (
    floorsById : Record<string, OfficeRnDFloor>,
    meetingRooms: OfficeRnDMeetingRoom[]
  ) => {
    const meetingRoomsWithFloor = meetingRooms.map((meetingRoom) => {
      const floor = meetingRoom.floor ? floorsById[meetingRoom.floor] : undefined;
      return {
        ...meetingRoom,
        floor: floor?.name || 'no floor',
      };
    });
    return keyBy(meetingRoomsWithFloor, '_id');
  };
}