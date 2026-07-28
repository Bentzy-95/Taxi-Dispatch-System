import { integer, pgEnum, pgTable, text, timestamp, varchar, numeric, index, serial } from "drizzle-orm/pg-core";

export const vehicleStatus = pgEnum("vehicle_status", ["available", "in_use", "offline"]);
export const driverStatus = pgEnum("driver_status", ["available", "busy", "offline"]);
export const bookingStatusEnum = pgEnum("booking_status", [
  "unassigned",
  "assigned",
  "en_route",
  "completed",
  "cancelled",
]);
export const recommendationStatus = pgEnum("recommendation_status", ["pending", "accepted", "rejected"]);

/**
 * Vehicles available to the dispatcher.
 */
export const vehicles = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  seats: integer("seats").notNull().default(4),
  status: vehicleStatus("status").default("available").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Vehicle = typeof vehicles.$inferSelect;
export type InsertVehicle = typeof vehicles.$inferInsert;

/**
 * Drivers. Each has a private `token` used to access their job view
 * without a login system (e.g. /driver/:token).
 */
export const drivers = pgTable(
  "drivers",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    token: varchar("token", { length: 32 }).notNull().unique(),
    vehicleId: integer("vehicle_id"),
    status: driverStatus("status").default("available").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tokenIdx: index("drivers_token_idx").on(table.token),
  }),
);

export type Driver = typeof drivers.$inferSelect;
export type InsertDriver = typeof drivers.$inferInsert;

/**
 * Bookings. Not airport-specific - pickup/dropoff can be anywhere.
 * flightNumber/airportCode are optional context for flight-related jobs
 * only; nothing in matching depends on them.
 *
 * `groupId` links two or more bookings that have been combined into one
 * driver's job (same driver, same vehicle, multiple stops). A driver's
 * live job list is always derived by querying bookings on driverId +
 * status, never a single "current booking" pointer, so a combined trip
 * can't hide a passenger from the driver.
 */
export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    bookingNumber: varchar("booking_number", { length: 20 }).notNull().unique(),
    passengerName: varchar("passenger_name", { length: 255 }).notNull(),
    passengerPhone: varchar("passenger_phone", { length: 20 }).notNull(),
    passengerCount: integer("passenger_count").notNull().default(1),
    flightNumber: varchar("flight_number", { length: 50 }),
    airportCode: varchar("airport_code", { length: 10 }),
    scheduledTime: timestamp("scheduled_time").notNull(),
    pickupLocation: text("pickup_location").notNull(),
    dropoffLocation: text("dropoff_location").notNull(),
    // Optional. Lets the matching engine estimate when this job's driver
    // becomes free (scheduledTime + this) so it can suggest chaining them
    // onto a nearby follow-on booking instead of sending a different,
    // farther-away driver. Left blank, this booking is simply never
    // considered as a chain candidate - no guessing at drive times.
    estimatedDurationMinutes: integer("estimated_duration_minutes"),
    status: bookingStatusEnum("status").default("unassigned").notNull(),
    driverId: integer("driver_id"),
    vehicleId: integer("vehicle_id"),
    groupId: varchar("group_id", { length: 32 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusIdx: index("bookings_status_idx").on(table.status),
    driverIdIdx: index("bookings_driver_id_idx").on(table.driverId),
    groupIdIdx: index("bookings_group_id_idx").on(table.groupId),
    scheduledTimeIdx: index("bookings_scheduled_time_idx").on(table.scheduledTime),
  }),
);

export type Booking = typeof bookings.$inferSelect;
export type InsertBooking = typeof bookings.$inferInsert;

/**
 * One recommendation is generated automatically whenever a booking is
 * created. It always proposes either a solo assignment or a grouping
 * with exactly one other existing booking.
 */
export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id").notNull(),
    suggestedVehicleId: integer("suggested_vehicle_id"),
    suggestedDriverId: integer("suggested_driver_id"),
    groupWithBookingId: integer("group_with_booking_id"),
    reasoning: text("reasoning").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    status: recommendationStatus("status").default("pending").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    bookingIdIdx: index("recommendations_booking_id_idx").on(table.bookingId),
    statusIdx: index("recommendations_status_idx").on(table.status),
  }),
);

export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = typeof recommendations.$inferInsert;
