import { isMidnightMode } from "./isMidnightMode";

const at = (hours: number, minutes = 0) => new Date(2026, 9, 30, hours, minutes);

describe("isMidnightMode", () => {
  it("is active from midnight", () => {
    expect(isMidnightMode(at(0, 0))).toBe(true);
  });

  it("is active right up until 6am", () => {
    expect(isMidnightMode(at(5, 59))).toBe(true);
  });

  it("ends at 6am", () => {
    expect(isMidnightMode(at(6, 0))).toBe(false);
  });

  it("is inactive late in the evening", () => {
    expect(isMidnightMode(at(23, 59))).toBe(false);
  });
});
