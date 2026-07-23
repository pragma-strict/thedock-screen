import { OfficeRnDDataAggregator } from "./OfficeRnDDataAggregator";

test('combineMeetingRoomsAndFloors combines two single entry items that match', () => {
  const aggregator = new OfficeRnDDataAggregator();
  expect(
    aggregator.combineMeetingRoomsAndFloors(
      {"10": {_id: "10", name: "Test Floor"}},
      [{_id: "0", name: "Test Room", floor: "10"}]
    )
  ).toStrictEqual(
    {"0": {_id: "0", name: "Test Room", floor: "10", floor: "Test Floor"}}
  )
})

test('combineOfficeRnDDataIntoAppBookings combines a set of single entry data items correctly', () => {
  const aggregator = new OfficeRnDDataAggregator();
  expect(
    aggregator.combineOfficeRnDDataIntoAppBookings(
      [{_id: "3", name: "Test Floor"}],
      [{_id: "0", name: "Test Room", floor: "3"}],
      [{
        _id: "1",
        title: "",
        start: "",
        end: "",
        timezone: "",
        resource: "0",
        company: "2",
        member: ""
      }],
      [{_id: "2", name: "Test Company"}],
      [],
      null,
    )
  ).toStrictEqual(
    [{
      _id: "1",
      startDateTime: "",
      endDateTime: "",
      timezone: "",
      room: "Test Room",
      floor: "Test Floor",
      summary: "",
      host: "Test Company",
      coffeeCount: 0,
      hasOwl: false,
    }]
  )
})

test('combineOfficeRnDDataIntoAppBookings uses member name as host when no company', () => {
  const aggregator = new OfficeRnDDataAggregator();
  expect(
    aggregator.combineOfficeRnDDataIntoAppBookings(
      [],
      [],
      [{
        _id: "",
        title: "",
        start: "",
        end: "",
        timezone: "",
        resource: "",
        company: "",
        member: "0"
      }],
      [],
      [{_id: "0", name: "Test Member"}],
      null,
    )
  ).toStrictEqual(
    [{
      _id: "",
      startDateTime: "",
      endDateTime: "",
      timezone: "",
      room: '',
      floor: '',
      summary: "",
      host: "Test Member",
      coffeeCount: 0,
      hasOwl: false,
    }]
  )
})