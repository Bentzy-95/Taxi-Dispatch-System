import { z } from "zod";
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));
export const createBookingInput = z.object({
  passengerName: z.string().trim().min(1, "Passenger name is required").max(255),
  passengerPhone: z.string().trim().min(1, "Phone number is required").max(20),
  passengerCount: z.coerce.number().int().min(1).max(16).default(1),
  // Both optional - this isn't airport-exclusive. Leave blank for a
  // regular point-to-point job.
  flightNumber: optionalText(50),
  airportCode: optionalText(4).transform((v) => (v ? v.toUpperCase() : undefined)),
  scheduledTime: z.coerce.date(),
  pickupLocation: z.string().trim().min(1, "Pickup location is required"),
  dropoffLocation: z.string().trim().min(1, "Dropoff location is required"),
  // Optional. If given, lets the engine suggest chaining this driver onto
  // a follow-on job once they're free nearby. Leave blank if unknown.
  estimatedDurationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingInput>;
export const updateBookingInput = z.object({
  bookingId: z.number().int(),
  passengerName: z.string().trim().min(1, "Passenger name is required").max(255),
  passengerPhone: z.string().trim().min(1, "Phone number is required").max(20),
  passengerCount: z.coerce.number().int().min(1).max(16).default(1),
  flightNumber: optionalText(50),
  airportCode: optionalText(4).transform((v) => (v ? v.toUpperCase() : undefined)),
  scheduledTime: z.coerce.date(),
  pickupLocation: z.string().trim().min(1, "Pickup location is required"),
  dropoffLocation: z.string().trim().min(1, "Dropoff location is required"),
  estimatedDurationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
});
export type UpdateBookingInput = z.infer<typeof updateBookingInput>;
export const bookingStatus = z.enum(["unassigned", "assigned", "en_route", "completed"]);
export type BookingStatusValue = z.infer<typeof bookingStatus>;
export const updateBookingStatusInput = z.object({
  bookingId: z.number().int(),
  status: bookingStatus,
  driverToken: z.string().optional(),
});
export const cancelBookingInput = z.object({
  bookingId: z.number().int(),
});
export const manualAssignInput = z.object({
  bookingId: z.number().int(),
  driverId: z.number().int(),
  vehicleId: z.number().int(),
});
export const recommendationDecisionInput = z.object({
  recommendationId: z.number().int(),
});
export const createDriverInput = z.object({
  name: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(1).max(20),
  vehicleId: z.number().int().optional(),
});
export const createVehicleInput = z.object({
  name: z.string().trim().min(1).max(255),
  seats: z.coerce.number().int().min(1).max(64).default(4),
});
export const deleteVehicleInput = z.object({
  vehicleId: z.number().int(),
});
export const deleteDriverInput = z.object({
  driverId: z.number().int(),
});
export const regenerateDriverLinkInput = z.object({
  driverId: z.number().int(),
});
