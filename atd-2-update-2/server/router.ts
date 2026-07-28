
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { bookings, drivers, recommendations, vehicles } from "../drizzle/schema";
import {
  cancelBookingInput,
  createBookingInput,
  createDriverInput,
  createVehicleInput,
  deleteDriverInput,
  deleteVehicleInput,
  manualAssignInput,
  regenerateDriverLinkInput,
  updateBookingInput,
  updateBookingStatusInput,
} from "../shared/schemas";
import { db } from "./db";
import { generateRecommendation, type MatchableBooking, type MatchableDriver } from "./matching";
import { publicProcedure, protectedProcedure, router } from "./trpc";
import { broadcastToAdmins, sendToDriver } from "./ws";

const bookingNumberId = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
const groupId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

const ACTIVE_BOOKING_STATUSES = ["unassigned", "assigned", "en_route"] as const;

async function loadMatchableState(excludeBookingId?: number) {
  const [allBookings, allDrivers, allVehicles] = await Promise.all([
    db.select().from(bookings).where(inArray(bookings.status, ["unassigned", "assigned", "en_route"])),
    db.select().from(drivers),
    db.select().from(vehicles),
  ]);

  const vehiclesById = new Map(allVehicles.map((v) => [v.id, v]));

  const matchableBookings: MatchableBooking[] = allBookings
    .filter((b) => b.id !== excludeBookingId)
    .map((b) => ({
      id: b.id,
      passengerCount: b.passengerCount,
      scheduledTime: b.scheduledTime,
      pickupLocation: b.pickupLocation,
      dropoffLocation: b.dropoffLocation,
      status: b.status,
      driverId: b.driverId,
      groupId: b.groupId,
      estimatedDurationMinutes: b.estimatedDurationMinutes,
    }));

  const matchableDrivers: MatchableDriver[] = allDrivers.map((d) => ({
    id: d.id,
    status: d.status,
    vehicleId: d.vehicleId,
    vehicleSeats: d.vehicleId ? (vehiclesById.get(d.vehicleId)?.seats ?? null) : null,
  }));

  return { matchableBookings, matchableDrivers };
}

async function markDriverAvailableIfIdle(driverId: number) {
  const stillActive = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.driverId, driverId), inArray(bookings.status, ["assigned", "en_route"])))
    .limit(1);

  if (stillActive.length === 0) {
    await db.update(drivers).set({ status: "available" }).where(eq(drivers.id, driverId));
  }
}

export const appRouter = router({
  auth: router({
    check: protectedProcedure.query(() => ({ ok: true })),
  }),

  vehicles: router({
    list: protectedProcedure.query(() => db.select().from(vehicles)),
    create: protectedProcedure.input(createVehicleInput).mutation(async ({ input }) => {
      const [vehicle] = await db.insert(vehicles).values(input).returning();
      return vehicle;
    }),

    delete: protectedProcedure.input(deleteVehicleInput).mutation(async ({ input }) => {
      const activeJobs = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.vehicleId, input.vehicleId), inArray(bookings.status, ["assigned", "en_route"])));
      if (activeJobs.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This vehicle has ${activeJobs.length} active job(s). Reassign or complete them first.`,
        });
      }

      // Clear it from any driver's default vehicle so nothing dangles.
      await db.update(drivers).set({ vehicleId: null }).where(eq(drivers.vehicleId, input.vehicleId));
      await db.delete(vehicles).where(eq(vehicles.id, input.vehicleId));
      return { deleted: true };
    }),
  }),

  drivers: router({
    list: protectedProcedure.query(() => db.select().from(drivers)),

    create: protectedProcedure.input(createDriverInput).mutation(async ({ input }) => {
      const token = groupId();
      const [driver] = await db.insert(drivers).values({ ...input, token }).returning();
      return driver;
    }),

    delete: protectedProcedure.input(deleteDriverInput).mutation(async ({ input }) => {
      const activeJobs = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.driverId, input.driverId), inArray(bookings.status, ["assigned", "en_route"])));
      if (activeJobs.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `This driver has ${activeJobs.length} active job(s). Reassign or wait for completion first.`,
        });
      }

      await db.delete(drivers).where(eq(drivers.id, input.driverId));
      return { deleted: true };
    }),

    regenerateLink: protectedProcedure.input(regenerateDriverLinkInput).mutation(async ({ input }) => {
      const newToken = groupId();
      const [driver] = await db
        .update(drivers)
        .set({ token: newToken })
        .where(eq(drivers.id, input.driverId))
        .returning();
      if (!driver) throw new TRPCError({ code: "NOT_FOUND", message: "Driver not found." });
      return driver; // old link stops working immediately - nothing still resolves to the old token
    }),

    jobs: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
      const [driver] = await db.select().from(drivers).where(eq(drivers.token, input.token));
      if (!driver) throw new TRPCError({ code: "NOT_FOUND", message: "Driver link not recognized." });

      const jobs = await db
        .select()
        .from(bookings)
        .where(and(eq(bookings.driverId, driver.id), inArray(bookings.status, ["assigned", "en_route"])))
        .orderBy(bookings.scheduledTime);

      return { driver, jobs };
    }),
  }),

  bookings: router({
    list: protectedProcedure.query(() => db.select().from(bookings).orderBy(asc(bookings.scheduledTime))),

    create: protectedProcedure.input(createBookingInput).mutation(async ({ input }) => {
      const number = `BK-${bookingNumberId()}`;
      const [booking] = await db
        .insert(bookings)
        .values({ ...input, bookingNumber: number })
        .returning();

      const { matchableBookings, matchableDrivers } = await loadMatchableState(booking.id);

      const match = generateRecommendation(
        {
          id: booking.id,
          passengerCount: booking.passengerCount,
          scheduledTime: booking.scheduledTime,
          pickupLocation: booking.pickupLocation,
          dropoffLocation: booking.dropoffLocation,
          status: booking.status,
          driverId: booking.driverId,
          groupId: booking.groupId,
          estimatedDurationMinutes: booking.estimatedDurationMinutes,
        },
        matchableBookings,
        matchableDrivers,
      );

      const [recommendation] = await db
        .insert(recommendations)
        .values({
          bookingId: booking.id,
          suggestedDriverId: match.suggestedDriverId,
          suggestedVehicleId: match.suggestedVehicleId,
          groupWithBookingId: match.groupWithBookingId,
          reasoning: match.reasoning,
          confidence: match.confidence.toFixed(2),
        })
        .returning();

      broadcastToAdmins({ type: "booking_created", bookingId: booking.id });
      return { booking, recommendation };
    }),

    update: protectedProcedure.input(updateBookingInput).mutation(async ({ input }) => {
      const { bookingId, ...fields } = input;
      const [existing] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });
      if (existing.status === "completed" || existing.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This booking is already completed or cancelled and can't be edited." });
      }

      await db.update(bookings).set(fields).where(eq(bookings.id, bookingId));

      // Details changed - if this booking wasn't assigned yet, its old
      // recommendation may no longer make sense (different pickup, time,
      // or party size), so regenerate it against the new details.
      if (existing.status === "unassigned") {
        await db
          .update(recommendations)
          .set({ status: "rejected" })
          .where(and(eq(recommendations.bookingId, bookingId), eq(recommendations.status, "pending")));

        const updated = await db.select().from(bookings).where(eq(bookings.id, bookingId)).then((r) => r[0]);
        const { matchableBookings, matchableDrivers } = await loadMatchableState(bookingId);
        const match = generateRecommendation(
          {
            id: updated.id,
            passengerCount: updated.passengerCount,
            scheduledTime: updated.scheduledTime,
            pickupLocation: updated.pickupLocation,
            dropoffLocation: updated.dropoffLocation,
            status: updated.status,
            driverId: updated.driverId,
            groupId: updated.groupId,
            estimatedDurationMinutes: updated.estimatedDurationMinutes,
          },
          matchableBookings,
          matchableDrivers,
        );
        await db.insert(recommendations).values({
          bookingId: updated.id,
          suggestedDriverId: match.suggestedDriverId,
          suggestedVehicleId: match.suggestedVehicleId,
          groupWithBookingId: match.groupWithBookingId,
          reasoning: match.reasoning,
          confidence: match.confidence.toFixed(2),
        });
      }

      broadcastToAdmins({ type: "booking_updated", bookingId });
      if (existing.driverId) {
        const [driver] = await db.select().from(drivers).where(eq(drivers.id, existing.driverId));
        if (driver) sendToDriver(driver.token, { type: "booking_updated", bookingId });
      }

      return db.select().from(bookings).where(eq(bookings.id, bookingId)).then((r) => r[0]);
    }),

    updateStatus: publicProcedure.input(updateBookingStatusInput).mutation(async ({ input, ctx }) => {
      const [existing] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });

      const requiredCode = process.env.ACCESS_CODE;
      const isAdmin = !requiredCode || ctx.accessCode === requiredCode;
      let isAssignedDriver = false;
      if (!isAdmin && existing.driverId && input.driverToken) {
        const [driver] = await db.select().from(drivers).where(eq(drivers.id, existing.driverId));
        isAssignedDriver = !!driver && driver.token === input.driverToken;
      }
      if (!isAdmin && !isAssignedDriver) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Not authorized to update this booking." });
      }

      const clearsAssignment = input.status === "unassigned";
      await db
        .update(bookings)
        .set({
          status: input.status,
          driverId: clearsAssignment ? null : existing.driverId,
          vehicleId: clearsAssignment ? null : existing.vehicleId,
          groupId: clearsAssignment ? null : existing.groupId,
        })
        .where(eq(bookings.id, input.bookingId));

      if ((input.status === "completed" || clearsAssignment) && existing.driverId) {
        await markDriverAvailableIfIdle(existing.driverId);
      }

      broadcastToAdmins({ type: "booking_updated", bookingId: input.bookingId });
      if (existing.driverId) {
        const [driver] = await db.select().from(drivers).where(eq(drivers.id, existing.driverId));
        if (driver) sendToDriver(driver.token, { type: "booking_updated", bookingId: input.bookingId });
      }

      return db.select().from(bookings).where(eq(bookings.id, input.bookingId)).then((r) => r[0]);
    }),

    manualAssign: protectedProcedure.input(manualAssignInput).mutation(async ({ input }) => {
      await db
        .update(bookings)
        .set({ status: "assigned", driverId: input.driverId, vehicleId: input.vehicleId })
        .where(eq(bookings.id, input.bookingId));
      await db.update(drivers).set({ status: "busy" }).where(eq(drivers.id, input.driverId));

      broadcastToAdmins({ type: "booking_updated", bookingId: input.bookingId });
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, input.driverId));
      if (driver) sendToDriver(driver.token, { type: "job_assigned", bookingId: input.bookingId });

      return db.select().from(bookings).where(eq(bookings.id, input.bookingId)).then((r) => r[0]);
    }),

    cancel: protectedProcedure.input(cancelBookingInput).mutation(async ({ input }) => {
      const [existing] = await db.select().from(bookings).where(eq(bookings.id, input.bookingId));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found." });

      await db
        .update(bookings)
        .set({ status: "cancelled", driverId: null, vehicleId: null, groupId: null })
        .where(eq(bookings.id, input.bookingId));

      // Any pending recommendation for this booking is now meaningless.
      await db
        .update(recommendations)
        .set({ status: "rejected" })
        .where(and(eq(recommendations.bookingId, input.bookingId), eq(recommendations.status, "pending")));

      if (existing.driverId) {
        await markDriverAvailableIfIdle(existing.driverId);
        const [driver] = await db.select().from(drivers).where(eq(drivers.id, existing.driverId));
        if (driver) sendToDriver(driver.token, { type: "booking_updated", bookingId: input.bookingId });
      }

      broadcastToAdmins({ type: "booking_updated", bookingId: input.bookingId });
      return { cancelled: true };
    }),
  }),

  recommendations: router({
    pending: protectedProcedure.query(() =>
      db.select().from(recommendations).where(eq(recommendations.status, "pending")),
    ),

    accept: protectedProcedure.input(z.object({ recommendationId: z.number().int() })).mutation(async ({ input }) => {
      const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, input.recommendationId));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found." });
      if (!rec.suggestedDriverId || !rec.suggestedVehicleId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This recommendation has no available driver to assign." });
      }

      let finalGroupId: string | null = null;
      if (rec.groupWithBookingId) {
        const [partner] = await db.select().from(bookings).where(eq(bookings.id, rec.groupWithBookingId));
        if (!partner) throw new TRPCError({ code: "NOT_FOUND", message: "The booking to group with no longer exists." });
        finalGroupId = partner.groupId ?? groupId();

        // Covers both cases uniformly: partner already had this same driver
        // (no-op update), or partner was still unassigned and is now being
        // assigned together with this booking for the first time.
        await db
          .update(bookings)
          .set({
            groupId: finalGroupId,
            status: "assigned",
            driverId: rec.suggestedDriverId,
            vehicleId: rec.suggestedVehicleId,
          })
          .where(eq(bookings.id, partner.id));

        // The partner may have its own separate pending recommendation
        // (generated when it was created). It's now stale - if left
        // pending, someone could accept it later and overwrite this
        // correct group assignment with a different, conflicting one.
        await db
          .update(recommendations)
          .set({ status: "rejected" })
          .where(and(eq(recommendations.bookingId, partner.id), eq(recommendations.status, "pending")));

        await db.update(drivers).set({ status: "busy" }).where(eq(drivers.id, rec.suggestedDriverId));
        broadcastToAdmins({ type: "booking_updated", bookingId: partner.id });
      }

      await db
        .update(bookings)
        .set({
          status: "assigned",
          driverId: rec.suggestedDriverId,
          vehicleId: rec.suggestedVehicleId,
          groupId: finalGroupId,
        })
        .where(eq(bookings.id, rec.bookingId));

      await db.update(drivers).set({ status: "busy" }).where(eq(drivers.id, rec.suggestedDriverId));
      await db.update(recommendations).set({ status: "accepted" }).where(eq(recommendations.id, rec.id));

      broadcastToAdmins({ type: "booking_updated", bookingId: rec.bookingId });
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, rec.suggestedDriverId));
      if (driver) sendToDriver(driver.token, { type: "job_assigned", bookingId: rec.bookingId });

      return db.select().from(bookings).where(eq(bookings.id, rec.bookingId)).then((r) => r[0]);
    }),

    reject: protectedProcedure.input(z.object({ recommendationId: z.number().int() })).mutation(async ({ input }) => {
      const [rec] = await db.select().from(recommendations).where(eq(recommendations.id, input.recommendationId));
      if (!rec) throw new TRPCError({ code: "NOT_FOUND", message: "Recommendation not found." });

      await db.update(recommendations).set({ status: "rejected" }).where(eq(recommendations.id, rec.id));

      const [booking] = await db.select().from(bookings).where(eq(bookings.id, rec.bookingId));
      const priorRejections = await db
        .select()
        .from(recommendations)
        .where(and(eq(recommendations.bookingId, rec.bookingId), ne(recommendations.status, "pending")));

      const { matchableBookings, matchableDrivers } = await loadMatchableState(booking.id);
      const match = generateRecommendation(
        {
          id: booking.id,
          passengerCount: booking.passengerCount,
          scheduledTime: booking.scheduledTime,
          pickupLocation: booking.pickupLocation,
          dropoffLocation: booking.dropoffLocation,
          status: booking.status,
          driverId: booking.driverId,
          groupId: booking.groupId,
          estimatedDurationMinutes: booking.estimatedDurationMinutes,
        },
        matchableBookings,
        matchableDrivers,
        {
          excludeDriverIds: priorRejections.map((r) => r.suggestedDriverId).filter((id): id is number => id != null),
          excludeGroupBookingIds: priorRejections
            .map((r) => r.groupWithBookingId)
            .filter((id): id is number => id != null),
        },
      );

      const [newRecommendation] = await db
        .insert(recommendations)
        .values({
          bookingId: booking.id,
          suggestedDriverId: match.suggestedDriverId,
          suggestedVehicleId: match.suggestedVehicleId,
          groupWithBookingId: match.groupWithBookingId,
          reasoning: match.reasoning,
          confidence: match.confidence.toFixed(2),
        })
        .returning();

      return newRecommendation;
    }),
  }),
});

export type AppRouter = typeof appRouter;
