import { describe, expect, it } from "vitest";
import { generateRecommendation, type MatchableBooking, type MatchableDriver } from "./matching";

function booking(overrides: Partial<MatchableBooking> & { id: number }): MatchableBooking {
  return {
    passengerCount: 1,
    scheduledTime: new Date("2026-08-01T15:00:00Z"),
    pickupLocation: "Hotel A, London",
    dropoffLocation: "42 Baker Street, London",
    status: "unassigned",
    driverId: null,
    groupId: null,
    ...overrides,
  };
}

function driver(overrides: Partial<MatchableDriver> & { id: number }): MatchableDriver {
  return {
    status: "available",
    vehicleId: 100,
    vehicleSeats: 4,
    ...overrides,
  };
}

describe("generateRecommendation - solo assignment", () => {
  it("assigns the smallest available vehicle that fits the party", () => {
    const newBooking = booking({ id: 1, passengerCount: 2 });
    const drivers = [
      driver({ id: 1, vehicleId: 10, vehicleSeats: 4 }),
      driver({ id: 2, vehicleId: 11, vehicleSeats: 8 }),
    ];
    const result = generateRecommendation(newBooking, [], drivers);
    expect(result.suggestedDriverId).toBe(1);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("skips drivers who are not available", () => {
    const newBooking = booking({ id: 1, passengerCount: 1 });
    const drivers = [driver({ id: 1, status: "busy" }), driver({ id: 2, status: "available" })];
    const result = generateRecommendation(newBooking, [], drivers);
    expect(result.suggestedDriverId).toBe(2);
  });

  it("returns no suggestion when nobody has enough seats", () => {
    const newBooking = booking({ id: 1, passengerCount: 6 });
    const drivers = [driver({ id: 1, vehicleSeats: 4 })];
    const result = generateRecommendation(newBooking, [], drivers);
    expect(result.suggestedDriverId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("works for a plain point-to-point job with no airport involved at all", () => {
    const newBooking = booking({
      id: 1,
      pickupLocation: "14 Elm Grove, Manchester",
      dropoffLocation: "The Ivy Restaurant, Manchester",
    });
    const drivers = [driver({ id: 1 })];
    const result = generateRecommendation(newBooking, [], drivers);
    expect(result.suggestedDriverId).toBe(1);
  });
});

describe("generateRecommendation - grouping (the John + Jane scenario)", () => {
  it("groups a new booking with an already-assigned booking at the same pickup, close in time", () => {
    const john = booking({
      id: 1,
      passengerCount: 1,
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:00:00Z"),
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({
      id: 2,
      passengerCount: 2,
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:05:00Z"), // 5 min later
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(jane, [john], drivers);

    expect(result.groupWithBookingId).toBe(1);
    expect(result.suggestedDriverId).toBe(1);
    expect(result.suggestedVehicleId).toBe(10);
  });

  it("groups two bookings that share a DROPOFF instead of a pickup (different starting points, same destination)", () => {
    const john = booking({
      id: 1,
      pickupLocation: "22 Elm Road, London",
      dropoffLocation: "The Grand Hotel, London",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({
      id: 2,
      pickupLocation: "9 Oak Avenue, London", // different pickup
      dropoffLocation: "The Grand Hotel, London", // same dropoff
      scheduledTime: new Date("2026-08-01T15:05:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBe(1);
  });

  it("the exact case reported: 3 passengers + 4 passengers into an 8-seat vehicle should combine", () => {
    const first = booking({
      id: 1,
      passengerCount: 3,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
    });
    const second = booking({
      id: 2,
      passengerCount: 4,
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:05:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8 })];

    const result = generateRecommendation(second, [first], drivers);
    expect(result.groupWithBookingId).toBe(1); // 3 + 4 = 7, fits comfortably in 8 seats
    expect(result.suggestedDriverId).toBe(1);
  });

  it("does not group when the combined party exceeds the vehicle's seats", () => {
    const john = booking({
      id: 1,
      passengerCount: 3,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({
      id: 2,
      passengerCount: 3, // 3 + 3 = 6, only 4 seats available
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:05:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("does not group when neither pickup nor dropoff match", () => {
    const john = booking({
      id: 1,
      pickupLocation: "Hotel A, London",
      dropoffLocation: "Airport",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({ id: 2, pickupLocation: "Hotel B, London", dropoffLocation: "Train Station" });
    const drivers = [driver({ id: 1 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("does not group when outside the time window", () => {
    const john = booking({
      id: 1,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
      scheduledTime: new Date("2026-08-01T15:00:00Z"),
    });
    const jane = booking({
      id: 2,
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:45:00Z"), // 45 min later - outside the current 30-min window
    });
    const drivers = [driver({ id: 1 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("accounts for passengers already in a group when a third booking joins", () => {
    const john = booking({
      id: 1,
      passengerCount: 2,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
      groupId: "grp_1",
    });
    const jane = booking({
      id: 2,
      passengerCount: 1,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
      groupId: "grp_1",
    });
    const mo = booking({
      id: 3,
      passengerCount: 1, // 2 + 1 + 1 = 4, exactly fits a 4-seat car
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:05:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(mo, [john, jane], drivers);
    expect(result.groupWithBookingId).not.toBeNull();
    expect(result.suggestedDriverId).toBe(1);
  });

  it("excludes a rejected group candidate when asked for the next-best option", () => {
    const john = booking({ id: 1, pickupLocation: "Hotel A, London", status: "assigned", driverId: 1 });
    const jane = booking({ id: 2, pickupLocation: "Hotel A, London" });
    const drivers = [driver({ id: 1, vehicleId: 10 }), driver({ id: 2, vehicleId: 20 })];

    const result = generateRecommendation(jane, [john], drivers, { excludeGroupBookingIds: [1] });
    expect(result.groupWithBookingId).toBeNull();
    expect(result.suggestedDriverId).toBe(1); // falls back to solo assignment on driver 1 (smallest fit)
  });
});

describe("generateRecommendation - two brand-new bookings, neither assigned yet", () => {
  it("groups two still-unassigned bookings together instead of assigning each solo", () => {
    const john = booking({ id: 1, passengerCount: 1, pickupLocation: "Hotel A, London", status: "unassigned" });
    const jane = booking({
      id: 2,
      passengerCount: 2,
      pickupLocation: "Hotel A, London",
      scheduledTime: new Date("2026-08-01T15:05:00Z"),
      status: "unassigned",
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBe(1);
    expect(result.suggestedDriverId).toBe(1);
  });

  it("prefers an already-assigned candidate over pairing two unassigned ones, when both are possible", () => {
    const alreadyAssigned = booking({
      id: 1,
      pickupLocation: "Hotel A, London",
      status: "assigned",
      driverId: 1,
      scheduledTime: new Date("2026-08-01T15:10:00Z"),
    });
    const stillUnassigned = booking({
      id: 2,
      pickupLocation: "Hotel A, London",
      status: "unassigned",
      scheduledTime: new Date("2026-08-01T15:02:00Z"),
    });
    const newBooking = booking({ id: 3, pickupLocation: "Hotel A, London" });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 }), driver({ id: 2, vehicleId: 20, vehicleSeats: 4 })];

    const result = generateRecommendation(newBooking, [alreadyAssigned, stillUnassigned], drivers);
    expect(result.groupWithBookingId).toBe(1);
  });

  it("does not pair two unassigned bookings if no driver has enough combined seats", () => {
    const john = booking({ id: 1, passengerCount: 3, pickupLocation: "Hotel A, London", status: "unassigned" });
    const jane = booking({ id: 2, passengerCount: 3, pickupLocation: "Hotel A, London" });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
    expect(result.suggestedDriverId).toBe(1);
  });
});

describe("generateRecommendation - chaining a driver onto a separate follow-on job", () => {
  it("the Geneva airport scenario: reuses the driver dropping off at Geneva for a new pickup there soon after", () => {
    const dropoffRun = booking({
      id: 1,
      passengerCount: 2,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"), // picked up 6am
      estimatedDurationMinutes: 180, // 3hr drive - free ~9:00am
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      passengerCount: 3,
      pickupLocation: "Geneva Airport",
      dropoffLocation: "Hotel Fitz Roy, Val Thorens",
      scheduledTime: new Date("2026-08-01T09:40:00Z"), // lands 40 min after driver's free
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8 })];

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    expect(result.suggestedDriverId).toBe(1);
    expect(result.suggestedVehicleId).toBe(10);
    expect(result.groupWithBookingId).toBeNull(); // separate trip, not a shared-car group
    expect(result.reasoning).toContain("#1");
  });

  it("does not use CHAIN matching without a duration estimate (though the driver may still be found genuinely free via the schedule-aware fallback)", () => {
    const dropoffRun = booking({
      id: 1,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      status: "assigned",
      driverId: 1,
      // no estimatedDurationMinutes
    });
    const newArrival = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T09:40:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    // Chain matching specifically requires a known duration - this must not
    // be a chain result (chain's reasoning always names the earlier booking).
    expect(result.reasoning).not.toContain("already dropping off");
    // But the driver IS genuinely free by any reasonable assumption (a
    // default-180-min job ending well before 9:40), so the schedule-aware
    // fallback correctly still finds them rather than wrongly saying no one's available.
    expect(result.suggestedDriverId).toBe(1);
  });

  it("does not use CHAIN matching outside its window (though a genuinely large gap may still resolve via the schedule-aware fallback)", () => {
    const dropoffRun = booking({
      id: 1,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180, // free ~9:00am
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T11:30:00Z"), // 2.5 hrs after free - outside the 60-min CHAIN window
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    expect(result.reasoning).not.toContain("already dropping off");
    expect(result.suggestedDriverId).toBe(1); // still genuinely free, just not via the CHAIN path
  });

  it("does not chain when the new pickup is before the driver is actually free", () => {
    const dropoffRun = booking({
      id: 1,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180, // free ~9:00am
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T08:30:00Z"), // lands before driver has arrived
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    expect(result.suggestedDriverId).toBeNull();
  });

  it("does not use CHAIN matching onto a mismatched location (though the driver may still be found genuinely free via the schedule-aware fallback)", () => {
    const dropoffRun = booking({
      id: 1,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Zurich Airport", // different airport
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180,
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T09:40:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    expect(result.reasoning).not.toContain("already dropping off");
    expect(result.suggestedDriverId).toBe(1); // genuinely free timewise, chain just correctly didn't claim credit
  });

  it("does not chain if the vehicle doesn't have enough seats for the new party", () => {
    const dropoffRun = booking({
      id: 1,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180,
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      passengerCount: 6,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T09:40:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 4, status: "busy" })]; // too small for 6

    const result = generateRecommendation(newArrival, [dropoffRun], drivers);
    expect(result.suggestedDriverId).toBeNull();
  });

  it("prefers an actual grouping opportunity over a chain, when both exist", () => {
    const sameCarShare = booking({
      id: 1,
      pickupLocation: "Geneva Airport",
      dropoffLocation: "Hotel Fitz Roy, Val Thorens",
      scheduledTime: new Date("2026-08-01T09:40:00Z"),
      status: "assigned",
      driverId: 2, // different driver, but same pickup - a real grouping option
    });
    const chainCandidate = booking({
      id: 3,
      pickupLocation: "Chalet Edelweiss, Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180,
      status: "assigned",
      driverId: 1,
    });
    const newArrival = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T09:45:00Z"),
    });
    const drivers = [
      driver({ id: 1, vehicleId: 10, vehicleSeats: 8 }),
      driver({ id: 2, vehicleId: 20, vehicleSeats: 8 }),
    ];

    const result = generateRecommendation(newArrival, [sameCarShare, chainCandidate], drivers);
    expect(result.groupWithBookingId).toBe(1); // grouping wins over chaining
    expect(result.suggestedDriverId).toBe(2);
  });
});

describe("generateRecommendation - a driver marked busy isn't automatically ruled out", () => {
  it("assigns a busy driver to a later job when there's a genuine gap (the core fix)", () => {
    // Driver has an early job with a real duration - clearly done well before the new one.
    const morningJob = booking({
      id: 1,
      pickupLocation: "Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180, // done ~9:00am
      status: "assigned",
      driverId: 1,
    });
    // A completely unrelated afternoon job, nowhere near the morning one.
    const afternoonJob = booking({
      id: 2,
      pickupLocation: "Courchevel",
      dropoffLocation: "Lyon Airport",
      scheduledTime: new Date("2026-08-01T15:00:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(afternoonJob, [morningJob], drivers);
    expect(result.suggestedDriverId).toBe(1);
    expect(result.suggestedVehicleId).toBe(10);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("still refuses a busy driver when their existing job genuinely overlaps the new one", () => {
    const job1 = booking({
      id: 1,
      pickupLocation: "Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180, // occupied 6:00-9:00
      status: "assigned",
      driverId: 1,
    });
    const job2 = booking({
      id: 2,
      pickupLocation: "Courchevel",
      dropoffLocation: "Lyon Airport",
      scheduledTime: new Date("2026-08-01T08:00:00Z"), // smack in the middle of job1
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(job2, [job1], drivers);
    expect(result.suggestedDriverId).toBeNull();
    expect(result.reasoning).toContain("schedule conflict");
  });

  it("checks ALL of a driver's active jobs, not just the most recent one", () => {
    const morning = booking({
      id: 1,
      pickupLocation: "Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 120, // done 8:00am
      status: "assigned",
      driverId: 1,
    });
    const evening = booking({
      id: 2,
      pickupLocation: "Geneva Airport",
      dropoffLocation: "Val Thorens",
      scheduledTime: new Date("2026-08-01T18:00:00Z"),
      estimatedDurationMinutes: 180,
      status: "assigned",
      driverId: 1,
    });
    // Sits comfortably in the gap between the two existing jobs.
    const midday = booking({
      id: 3,
      pickupLocation: "Courchevel",
      dropoffLocation: "Meribel",
      scheduledTime: new Date("2026-08-01T12:00:00Z"),
    });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" })];

    const result = generateRecommendation(midday, [morning, evening], drivers);
    expect(result.suggestedDriverId).toBe(1);
  });

  it("prefers a genuinely idle driver over a busy-but-free one when both fit", () => {
    const morningJob = booking({
      id: 1,
      pickupLocation: "Val Thorens",
      dropoffLocation: "Geneva Airport",
      scheduledTime: new Date("2026-08-01T06:00:00Z"),
      estimatedDurationMinutes: 180,
      status: "assigned",
      driverId: 1,
    });
    const newJob = booking({
      id: 2,
      pickupLocation: "Courchevel",
      dropoffLocation: "Lyon Airport",
      scheduledTime: new Date("2026-08-01T15:00:00Z"),
    });
    const drivers = [
      driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "busy" }), // free, but technically busy elsewhere
      driver({ id: 2, vehicleId: 20, vehicleSeats: 8, status: "available" }), // truly idle
    ];

    const result = generateRecommendation(newJob, [morningJob], drivers);
    expect(result.suggestedDriverId).toBe(2); // the idle one, simpler choice, all else equal
  });

  it("never assigns an offline driver even with a wide-open schedule", () => {
    const newJob = booking({ id: 1, pickupLocation: "A", dropoffLocation: "B", scheduledTime: new Date("2026-08-01T12:00:00Z") });
    const drivers = [driver({ id: 1, vehicleId: 10, vehicleSeats: 8, status: "offline" })];

    const result = generateRecommendation(newJob, [], drivers);
    expect(result.suggestedDriverId).toBeNull();
  });
});

describe("generateRecommendation - typo-tolerant location matching", () => {
  it("still groups when a location is spelled slightly differently (typo)", () => {
    const john = booking({ id: 1, pickupLocation: "Heathrow Terminal 5", status: "assigned", driverId: 1 });
    const jane = booking({ id: 2, pickupLocation: "Heathrow Terminl 5" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBe(1);
  });

  it("tolerates a couple of wrong letters in a longer address", () => {
    const john = booking({ id: 1, pickupLocation: "The Grosvenor Hotel, Park Lane", status: "assigned", driverId: 1 });
    const jane = booking({ id: 2, pickupLocation: "The Grosvenour Hotell, Park Lane" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBe(1);
  });

  it("does NOT group different terminal numbers, even though the text is nearly identical", () => {
    const john = booking({
      id: 1,
      pickupLocation: "Heathrow Terminal 3",
      dropoffLocation: "10 Downing Street",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({ id: 2, pickupLocation: "Heathrow Terminal 5", dropoffLocation: "Buckingham Palace" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("does NOT group different single-letter unit codes (e.g. Hotel A vs Hotel B)", () => {
    const john = booking({
      id: 1,
      pickupLocation: "Hotel A, London",
      dropoffLocation: "10 Downing Street",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({ id: 2, pickupLocation: "Hotel B, London", dropoffLocation: "Buckingham Palace" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("does NOT group different house/flat numbers", () => {
    const john = booking({
      id: 1,
      pickupLocation: "12 Main Street",
      dropoffLocation: "10 Downing Street",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({ id: 2, pickupLocation: "21 Main Street", dropoffLocation: "Buckingham Palace" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });

  it("does NOT group genuinely different locations just because they're short", () => {
    const john = booking({
      id: 1,
      pickupLocation: "The Ritz",
      dropoffLocation: "10 Downing Street",
      status: "assigned",
      driverId: 1,
    });
    const jane = booking({ id: 2, pickupLocation: "The Savoy", dropoffLocation: "Buckingham Palace" });
    const drivers = [driver({ id: 1, vehicleId: 10 })];

    const result = generateRecommendation(jane, [john], drivers);
    expect(result.groupWithBookingId).toBeNull();
  });
});
