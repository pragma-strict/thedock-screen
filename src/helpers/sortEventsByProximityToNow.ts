import { AppBooking } from "../services/OfficeRnDTypes/Booking";

export const sortEventsByProximityToNow = (events: AppBooking[]): AppBooking[] => {
  const now = new Date().getTime();

  return [...events].sort((a, b) => {
    const timeA = new Date(a.startDateTime).getTime();
    const timeB = new Date(b.startDateTime).getTime();

    // Calculate absolute time differences from now
    const diffA = Math.abs(timeA - now);
    const diffB = Math.abs(timeB - now);

    // If one is in the future and the other is in the past, prioritize the future event
    const isAFuture = timeA >= now;
    const isBFuture = timeB >= now;

    if (isAFuture && !isBFuture) return -1; // A is future, B is past → A first
    if (!isAFuture && isBFuture) return 1;  // B is future, A is past → B first

    // If both are future or both are past, sort by proximity (closest to now first)
    return diffA - diffB;
  });
};