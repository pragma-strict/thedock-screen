import { stripRoomNameSuffix } from "./stripRoomNameSuffix";

describe("stripRoomNameSuffix", () => {
  it("removes a trailing parenthetical and the space before it", () => {
    expect(stripRoomNameSuffix("Boardroom (10-12 ppl)")).toBe("Boardroom");
  });

  it("removes the parenthetical even without a leading space", () => {
    expect(stripRoomNameSuffix("Focus Room(2)")).toBe("Focus Room");
  });

  it("trims trailing whitespace after the parenthetical", () => {
    expect(stripRoomNameSuffix("Huddle (4 ppl) ")).toBe("Huddle");
  });

  it("leaves names without a trailing parenthetical untouched", () => {
    expect(stripRoomNameSuffix("The Library")).toBe("The Library");
  });

  it("only strips the trailing group, keeping earlier parentheses", () => {
    expect(stripRoomNameSuffix("Room (West) (6 ppl)")).toBe("Room (West)");
  });

  it("handles an empty string", () => {
    expect(stripRoomNameSuffix("")).toBe("");
  });
});
