/**
 * Deterministic matching engine.
 *
 * Deciding whether two trips should share a vehicle is a
 * constraint-satisfaction problem (location, time window, seats) - not
 * something that benefits from an LLM call. This module is pure and has
 * no I/O, so it can be unit tested without a database.
 *
 * Not airport-specific: two bookings combine if they share EITHER a
 * pickup point or a dropoff point (within the time window and seat
 * capacity), regardless of what the trip is for.
 */

export const GROUPING_WINDOW_MINUTES = 30;

/** How soon after a driver's estimated free time a follow-on booking's
 * pickup must fall for a chain suggestion to fire. Tune this if 60 min
 * is too tight or too loose for how your routes actually run. */
export const CHAIN_WINDOW_MINUTES = 60;

export interface MatchableBooking {
  id: number;
  passengerCount: number;
  scheduledTime: Date;
  pickupLocation: string;
  dropoffLocation: string;
  status: "unassigned" | "assigned" | "en_route" | "completed" | "cancelled";
  driverId: number | null;
  groupId: string | null;
  /** Minutes this job is expected to take, if known. Used only for chain
   * suggestions - a job with no estimate is never offered as a chain
   * candidate (no drive-time guessing). */
  estimatedDurationMinutes?: number | null;
}

export interface MatchableDriver {
  id: number;
  status: "available" | "busy" | "offline";
  vehicleId: number | null;
  vehicleSeats: number | null;
}

export interface MatchResult {
  suggestedDriverId: number | null;
  suggestedVehicleId: number | null;
  groupWithBookingId: number | null;
  reasoning: string;
  confidence: number;
}

function normalizeLocation(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/** Standard edit-distance: how many single-character insertions,
 * deletions, or substitutions turn `a` into `b`. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      currentRow.push(
        Math.min(
          currentRow[j] + 1, // insertion
          previousRow[j + 1] + 1, // deletion
          previousRow[j] + (a[i] === b[j] ? 0 : 1), // substitution
        ),
      );
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}

/** A token that's likely doing the actual distinguishing work in a
 * location name - a terminal/gate/flat number, a single-letter block or
 * unit code, part of a postcode - rather than just an ordinary word. */
function isIdentifierToken(token: string): boolean {
  return token.length <= 2 || /\d/.test(token);
}

function identifierTokens(normalized: string): string[] {
  return normalized.split(" ").filter(isIdentifierToken).sort();
}

/** True if two location strings are close enough to treat as the same
 * place. Ordinary words tolerate small typos. Anything that looks like
 * an identifier - numbers, single letters - must match exactly, so
 * "Terminal 3" is never treated as the same place as "Terminal 5" just
 * because the text is similar. */
function locationsMatch(a: string, b: string): boolean {
  const na = normalizeLocation(a);
  const nb = normalizeLocation(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const idA = identifierTokens(na);
  const idB = identifierTokens(nb);
  if (idA.length !== idB.length || !idA.every((t, i) => t === idB[i])) return false;

  const distance = levenshteinDistance(na, nb);
  const threshold = Math.max(2, Math.round(Math.max(na.length, nb.length) * 0.15));
  return distance <= threshold;
}

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/** Total passengers already committed to a booking's group (or just the
 * booking itself if it isn't part of a group yet). */
function groupPassengerTotal(booking: MatchableBooking, allBookings: MatchableBooking[]): number {
  if (!booking.groupId) return booking.passengerCount;
  return allBookings.filter((b) => b.groupId === booking.groupId).reduce((sum, b) => sum + b.passengerCount, 0);
}

export interface GenerateRecommendationOptions {
  /** Driver ids to skip - used when the admin rejects a suggestion and asks for the next-best option. */
  excludeDriverIds?: number[];
  /** Bookings to skip as group candidates - same purpose as excludeDriverIds. */
  excludeGroupBookingIds?: number[];
}

interface CandidateMatch {
  candidate: MatchableBooking;
  driver: MatchableDriver;
  diffMinutes: number;
  sharedLeg: "pickup" | "drop-off";
}

/** Which leg (if any) two bookings share, within the time window. */
function findSharedLeg(a: MatchableBooking, b: MatchableBooking): "pickup" | "drop-off" | null {
  if (minutesBetween(a.scheduledTime, b.scheduledTime) > GROUPING_WINDOW_MINUTES) return null;
  if (locationsMatch(a.pickupLocation, b.pickupLocation)) return "pickup";
  if (locationsMatch(a.dropoffLocation, b.dropoffLocation)) return "drop-off";
  return null;
}

function buildGroupResult(match: CandidateMatch, newBooking: MatchableBooking, existingBookings: MatchableBooking[]): MatchResult {
  const { candidate, driver, diffMinutes, sharedLeg } = match;
  const combinedTotal = groupPassengerTotal(candidate, existingBookings) + newBooking.passengerCount;
  const confidence = Math.max(0.6, 0.97 - diffMinutes / (GROUPING_WINDOW_MINUTES * 10));
  const statusNote =
    candidate.status === "assigned" ? "already has this driver" : "also still unassigned - both assigned together";
  const candidateLegText = sharedLeg === "pickup" ? candidate.pickupLocation : candidate.dropoffLocation;
  const newLegText = sharedLeg === "pickup" ? newBooking.pickupLocation : newBooking.dropoffLocation;
  const locationNote =
    normalizeLocation(candidateLegText) === normalizeLocation(newLegText)
      ? ""
      : " (spelled slightly differently, matched automatically)";

  return {
    suggestedDriverId: driver.id,
    suggestedVehicleId: driver.vehicleId,
    groupWithBookingId: candidate.id,
    reasoning:
      `Same ${sharedLeg} location as booking #${candidate.id}${locationNote}, ${Math.round(diffMinutes)} min apart (${statusNote}). ` +
      `Combined party of ${combinedTotal} fits the ${driver.vehicleSeats}-seat vehicle.`,
    confidence: Number(confidence.toFixed(2)),
  };
}

interface ChainCandidateMatch {
  candidate: MatchableBooking;
  driver: MatchableDriver;
  freeAt: Date;
  gapMinutes: number;
}

/** When this job's driver is expected to be free, given its pickup time
 * plus its estimated duration. Null if no duration was ever recorded. */
function estimatedFreeTime(booking: MatchableBooking): Date | null {
  if (booking.estimatedDurationMinutes == null) return null;
  return new Date(booking.scheduledTime.getTime() + booking.estimatedDurationMinutes * 60000);
}

/**
 * Finds a driver who is currently out on a DIFFERENT job that drops off
 * where this new booking picks up, and who'll be free in time for it.
 * This isn't a group (different passengers, two separate trips) - it's
 * reusing the same driver back-to-back instead of sending someone else
 * from further away, which matters most on long routes (e.g. an airport
 * transfer to a ski resort) where an empty return leg is expensive.
 */
function findChainCandidate(
  newBooking: MatchableBooking,
  existingBookings: MatchableBooking[],
  drivers: MatchableDriver[],
  excludeDriverIds: Set<number>,
): ChainCandidateMatch | null {
  const driversById = new Map(drivers.map((d) => [d.id, d]));
  let best: ChainCandidateMatch | null = null;

  for (const candidate of existingBookings) {
    if (candidate.status !== "assigned" && candidate.status !== "en_route") continue;
    if (!candidate.driverId || excludeDriverIds.has(candidate.driverId)) continue;
    if (candidate.id === newBooking.id) continue;
    if (!locationsMatch(candidate.dropoffLocation, newBooking.pickupLocation)) continue;

    const freeAt = estimatedFreeTime(candidate);
    if (!freeAt) continue; // no duration recorded - can't responsibly chain off this one

    const gapMinutes = (newBooking.scheduledTime.getTime() - freeAt.getTime()) / 60000;
    // Must be free before (or right at) the new pickup, and not so far
    // ahead of it that the driver would just be sitting around idle.
    if (gapMinutes < 0 || gapMinutes > CHAIN_WINDOW_MINUTES) continue;

    const driver = driversById.get(candidate.driverId);
    if (!driver || driver.vehicleSeats == null) continue;
    if (driver.vehicleSeats < newBooking.passengerCount) continue;

    if (!best || gapMinutes < best.gapMinutes) best = { candidate, driver, freeAt, gapMinutes };
  }

  return best;
}

function formatTime(d: Date): string {
  return d.toISOString().slice(11, 16) + " UTC";
}

function buildChainResult(match: ChainCandidateMatch): MatchResult {
  const { candidate, driver, freeAt, gapMinutes } = match;
  const confidence = Math.max(0.55, 0.88 - gapMinutes / (CHAIN_WINDOW_MINUTES * 2));
  return {
    suggestedDriverId: driver.id,
    suggestedVehicleId: driver.vehicleId,
    groupWithBookingId: null,
    reasoning:
      `Driver is already dropping off booking #${candidate.id} at a matching location, ` +
      `estimated free around ${formatTime(freeAt)} - about ${Math.round(gapMinutes)} min before this pickup. ` +
      `Reusing them avoids sending a separate vehicle from elsewhere.`,
    confidence: Number(confidence.toFixed(2)),
  };
}

export function generateRecommendation(
  newBooking: MatchableBooking,
  existingBookings: MatchableBooking[],
  drivers: MatchableDriver[],
  options: GenerateRecommendationOptions = {},
): MatchResult {
  const excludeDriverIds = new Set(options.excludeDriverIds ?? []);
  const excludeGroupBookingIds = new Set(options.excludeGroupBookingIds ?? []);
  const driversById = new Map(drivers.map((d) => [d.id, d]));

  // --- 1. Prefer joining a booking that already has a driver assigned. ---
  // Least disruptive: that driver's already briefed and moving toward the pickup.
  let best: CandidateMatch | null = null;
  for (const candidate of existingBookings) {
    if (candidate.status !== "assigned" || !candidate.driverId) continue;
    if (candidate.id === newBooking.id || excludeGroupBookingIds.has(candidate.id)) continue;
    const sharedLeg = findSharedLeg(candidate, newBooking);
    if (!sharedLeg) continue;
    const driver = driversById.get(candidate.driverId);
    if (!driver || driver.vehicleSeats == null) continue;
    const combinedTotal = groupPassengerTotal(candidate, existingBookings) + newBooking.passengerCount;
    if (combinedTotal > driver.vehicleSeats) continue;

    const diffMinutes = minutesBetween(candidate.scheduledTime, newBooking.scheduledTime);
    if (!best || diffMinutes < best.diffMinutes) best = { candidate, driver, diffMinutes, sharedLeg };
  }
  if (best) return buildGroupResult(best, newBooking, existingBookings);

  // --- 2. No assigned candidate - look for another still-unassigned ---
  // booking to pair fresh with a new driver. This covers two bookings
  // arriving close together before either has been accepted yet, which
  // otherwise would each get assigned solo and never combined.
  let bestPair: CandidateMatch | null = null;
  for (const candidate of existingBookings) {
    if (candidate.status !== "unassigned") continue;
    if (candidate.id === newBooking.id || excludeGroupBookingIds.has(candidate.id)) continue;
    const sharedLeg = findSharedLeg(candidate, newBooking);
    if (!sharedLeg) continue;

    const combinedTotal = candidate.passengerCount + newBooking.passengerCount;
    const driver = drivers
      .filter((d) => d.status === "available" && !excludeDriverIds.has(d.id) && d.vehicleSeats != null)
      .filter((d) => (d.vehicleSeats as number) >= combinedTotal)
      .sort((a, b) => (a.vehicleSeats as number) - (b.vehicleSeats as number) || a.id - b.id)[0];
    if (!driver) continue;

    const diffMinutes = minutesBetween(candidate.scheduledTime, newBooking.scheduledTime);
    if (!bestPair || diffMinutes < bestPair.diffMinutes) bestPair = { candidate, driver, diffMinutes, sharedLeg };
  }
  if (bestPair) return buildGroupResult(bestPair, newBooking, existingBookings);

  // --- 3. No grouping opportunity - is a driver already headed here on a ---
  // separate job, about to be free nearby? Reusing them beats sending a
  // different driver from elsewhere, especially on long routes.
  const chain = findChainCandidate(newBooking, existingBookings, drivers, excludeDriverIds);
  if (chain) return buildChainResult(chain);

  // --- 4. No grouping or chaining opportunity anywhere - solo assignment. ---
  const availableDrivers = drivers.filter((d) => d.status === "available" && !excludeDriverIds.has(d.id));
  const chosen = availableDrivers
    .filter((d) => d.vehicleSeats != null)
    .filter((d) => (d.vehicleSeats as number) >= newBooking.passengerCount)
    .sort((a, b) => (a.vehicleSeats as number) - (b.vehicleSeats as number) || a.id - b.id)[0];

  if (!chosen) {
    // Distinguish "nobody's free" from "someone's free but has no vehicle
    // attached" from "everyone free is in too small a car" - these need
    // completely different fixes, so a generic message just wastes the
    // dispatcher's time guessing.
    const withoutVehicle = availableDrivers.filter((d) => d.vehicleSeats == null).length;
    let reasoning: string;
    if (availableDrivers.length === 0) {
      reasoning = `No driver is currently marked available.`;
    } else if (withoutVehicle === availableDrivers.length) {
      reasoning = `${withoutVehicle} driver(s) are available but have no vehicle assigned - give them one in Fleet setup so they can be matched.`;
    } else {
      reasoning = `No available driver currently has a vehicle with enough seats for ${newBooking.passengerCount} passenger(s).`;
    }
    return { suggestedDriverId: null, suggestedVehicleId: null, groupWithBookingId: null, reasoning, confidence: 0 };
  }

  return {
    suggestedDriverId: chosen.id,
    suggestedVehicleId: chosen.vehicleId,
    groupWithBookingId: null,
    reasoning: `No other booking to combine with in the same ${GROUPING_WINDOW_MINUTES}-minute window. Assigning the smallest available vehicle that fits ${newBooking.passengerCount} passenger(s) (${chosen.vehicleSeats} seats).`,
    confidence: 0.75,
  };
}
