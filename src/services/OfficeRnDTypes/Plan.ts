// A "plan" in OfficeRnD covers memberships, day passes, and add-on services.
// Booking extras reference plans of `type: "service"` (e.g. "Coffee/Tea
// Service, per person"). We only need the id and name to identify them.
export type OfficeRnDPlan = {
  _id: string;
  name: string;
  type?: string;
  price?: number;
};
