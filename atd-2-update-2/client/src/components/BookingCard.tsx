
import { format } from "date-fns";
import { Pencil, Trash2, Users, TriangleAlert, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Booking } from "../../../drizzle/schema";
import { trpc } from "../lib/trpc";
import { colorForGroup } from "../lib/groupColor";
import { Badge, Button, Select } from "./ui";

type Recommendation = {
  id: number;
  bookingId: number;
  reasoning: string;
  confidence: string | null;
  groupWithBookingId: number | null;
  suggestedDriverId: number | null;
};

function toLocalInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function BookingCard({
  booking,
  recommendation,
  onDragStart,
}: {
  booking: Booking;
  recommendation?: Recommendation;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showManualAssign, setShowManualAssign] = useState(false);
  const [manualDriverId, setManualDriverId] = useState<string>("");

  const driversQuery = trpc.drivers.list.useQuery();
  const vehiclesQuery = trpc.vehicles.list.useQuery();
  const vehiclesById = new Map((vehiclesQuery.data ?? []).map((v) => [v.id, v]));

  const [form, setForm] = useState({
    passengerName: booking.passengerName,
    passengerPhone: booking.passengerPhone,
    passengerCount: booking.passengerCount,
    scheduledTime: toLocalInputValue(new Date(booking.scheduledTime)),
    pickupLocation: booking.pickupLocation,
    dropoffLocation: booking.dropoffLocation,
    flightNumber: booking.flightNumber ?? "",
    airportCode: booking.airportCode ?? "",
  });

  const accept = trpc.recommendations.accept.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.recommendations.pending.invalidate();
      utils.drivers.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });
  const reject = trpc.recommendations.reject.useMutation({
    onSuccess: () => utils.recommendations.pending.invalidate(),
    onError: (err) => setError(err.message),
  });
  const cancelBooking = trpc.bookings.cancel.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.recommendations.pending.invalidate();
      utils.drivers.list.invalidate();
    },
    onError: (err) => setError(err.message),
  });
  const updateBooking = trpc.bookings.update.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.recommendations.pending.invalidate();
      setIsEditing(false);
    },
    onError: (err) => setError(err.message),
  });
  const manualAssign = trpc.bookings.manualAssign.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.recommendations.pending.invalidate();
      utils.drivers.list.invalidate();
      setShowManualAssign(false);
      setManualDriverId("");
    },
    onError: (err) => setError(err.message),
  });

  function handleManualAssign() {
    setError(null);
    const driver = (driversQuery.data ?? []).find((d) => d.id === Number(manualDriverId));
    if (!driver || !driver.vehicleId) return;
    const vehicle = vehiclesById.get(driver.vehicleId);

    // Soft checks only - the dispatcher can see the mismatch and still knows
    // things the system doesn't (a regular booked in a bigger car, a driver
    // who'll actually be free sooner than their status shows, etc). Warn,
    // don't block.
    const warnings: string[] = [];
    if (vehicle && vehicle.seats < booking.passengerCount) {
      warnings.push(`this vehicle seats ${vehicle.seats}, this trip has ${booking.passengerCount} passengers`);
    }
    if (driver.status === "busy") {
      warnings.push(`this driver is currently marked busy on another job`);
    }
    if (warnings.length > 0) {
      const proceed = window.confirm(`Heads up: ${warnings.join("; ")}. Assign anyway?`);
      if (!proceed) return;
    }

    manualAssign.mutate({ bookingId: booking.id, driverId: driver.id, vehicleId: driver.vehicleId });
  }

  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => utils.bookings.list.invalidate(),
    onError: (err) => setError(err.message),
  });

  function handleDelete() {
    setError(null);
    if (!window.confirm(`Delete booking for ${booking.passengerName}? This can't be undone.`)) return;
    cancelBooking.mutate({ bookingId: booking.id });
  }

  function handleSave() {
    setError(null);
    updateBooking.mutate({
      bookingId: booking.id,
      passengerName: form.passengerName,
      passengerPhone: form.passengerPhone,
      passengerCount: Number(form.passengerCount),
      scheduledTime: new Date(form.scheduledTime),
      pickupLocation: form.pickupLocation,
      dropoffLocation: form.dropoffLocation,
      flightNumber: form.flightNumber || undefined,
      airportCode: form.airportCode || undefined,
    });
  }

  const canEdit = booking.status !== "completed" && booking.status !== "cancelled";

  if (isEditing) {
    return (
      <div className="space-y-2 border border-ink bg-paper p-3 text-sm shadow-sm">
        <input
          className="w-full border border-line px-2 py-1 text-xs"
          value={form.passengerName}
          onChange={(e) => setForm({ ...form, passengerName: e.target.value })}
          placeholder="Passenger name"
        />
        <input
          className="w-full border border-line px-2 py-1 text-xs"
          value={form.passengerPhone}
          onChange={(e) => setForm({ ...form, passengerPhone: e.target.value })}
          placeholder="Phone"
        />
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={16}
            className="w-1/3 border border-line px-2 py-1 text-xs"
            value={form.passengerCount}
            onChange={(e) => setForm({ ...form, passengerCount: Number(e.target.value) })}
            placeholder="Seats"
          />
          <input
            type="datetime-local"
            className="w-2/3 border border-line px-2 py-1 text-xs"
            value={form.scheduledTime}
            onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })}
          />
        </div>
        <input
          className="w-full border border-line px-2 py-1 text-xs"
          value={form.pickupLocation}
          onChange={(e) => setForm({ ...form, pickupLocation: e.target.value })}
          placeholder="Pickup location"
        />
        <input
          className="w-full border border-line px-2 py-1 text-xs"
          value={form.dropoffLocation}
          onChange={(e) => setForm({ ...form, dropoffLocation: e.target.value })}
          placeholder="Dropoff location"
        />
        <div className="flex gap-2">
          <input
            className="w-1/2 border border-line px-2 py-1 text-xs"
            value={form.flightNumber}
            onChange={(e) => setForm({ ...form, flightNumber: e.target.value })}
            placeholder="Flight (optional)"
          />
          <input
            className="w-1/2 border border-line px-2 py-1 text-xs"
            value={form.airportCode}
            onChange={(e) => setForm({ ...form, airportCode: e.target.value })}
            placeholder="Airport code (optional)"
          />
        </div>

        {error && <p className="text-xs font-medium text-signal">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="button" className="flex-1 !py-1.5 text-xs" disabled={updateBooking.isPending} onClick={handleSave}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="flex-1 !py-1.5 text-xs"
            onClick={() => {
              setIsEditing(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      style={booking.groupId ? { borderLeftColor: colorForGroup(booking.groupId), borderLeftWidth: "4px" } : undefined}
      className="cursor-grab space-y-2 border border-line bg-paper p-3 text-sm shadow-sm active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{booking.passengerName}</p>
          <p className="text-xs text-muted">{booking.bookingNumber}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              title="Edit booking"
              className="text-muted hover:text-ink"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleDelete}
            disabled={cancelBooking.isPending}
            title="Delete booking"
            className="text-muted hover:text-signal"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted">{format(new Date(booking.scheduledTime), "d MMM, HH:mm")}</p>

      <div className="space-y-0.5 text-xs">
        <p>
          <span className="text-muted">From </span>
          {booking.pickupLocation}
        </p>
        <p>
          <span className="text-muted">To </span>
          {booking.dropoffLocation}
        </p>
        {booking.flightNumber && (
          <p className="text-muted">
            Flight {booking.flightNumber}
            {booking.airportCode ? ` · ${booking.airportCode}` : ""}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {booking.passengerCount}
        </span>
        {booking.groupId && (
          <Badge className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: colorForGroup(booking.groupId) }}
            />
            combined trip
          </Badge>
        )}
      </div>

      {(booking.status === "assigned" || booking.status === "en_route") && (
        <Button
          type="button"
          variant="ghost"
          className="w-full !py-1.5 text-xs"
          disabled={updateStatus.isPending}
          onClick={() =>
            updateStatus.mutate({
              bookingId: booking.id,
              status: booking.status === "assigned" ? "en_route" : "completed",
            })
          }
        >
          <span className="inline-flex items-center justify-center gap-1">
            Mark {booking.status === "assigned" ? "en route" : "completed"} <ChevronRight className="h-3.5 w-3.5" />
          </span>
        </Button>
      )}

      {recommendation && (
        <div className="border-t border-line pt-2">
          <p className="text-xs leading-snug text-ink">{recommendation.reasoning}</p>
          {recommendation.groupWithBookingId && (
            <p className="mt-1 text-xs font-semibold text-signal">Groups with booking #{recommendation.groupWithBookingId}</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              className="flex-1 !py-1.5 text-xs"
              disabled={!recommendation.suggestedDriverId || accept.isPending}
              onClick={() => accept.mutate({ recommendationId: recommendation.id })}
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="flex-1 !py-1.5 text-xs"
              disabled={reject.isPending}
              onClick={() => reject.mutate({ recommendationId: recommendation.id })}
            >
              Reject
            </Button>
          </div>
          {!recommendation.suggestedDriverId && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
              <TriangleAlert className="h-3.5 w-3.5" /> No driver fits automatically - assign one yourself below.
            </p>
          )}
        </div>
      )}

      {canEdit && (
        <div className="border-t border-line pt-2">
          {!showManualAssign ? (
            <button
              type="button"
              onClick={() => setShowManualAssign(true)}
              className="text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink"
            >
              Assign manually / override
            </button>
          ) : (
            <div className="space-y-2">
              <Select value={manualDriverId} onChange={(e) => setManualDriverId(e.target.value)} className="text-xs">
                <option value="">Choose a driver...</option>
                {(driversQuery.data ?? [])
                  .filter((d) => d.vehicleId)
                  .map((d) => {
                    const vehicle = vehiclesById.get(d.vehicleId!);
                    const mismatch = vehicle && vehicle.seats < booking.passengerCount;
                    return (
                      <option key={d.id} value={d.id}>
                        {d.name} - {vehicle?.name ?? "no vehicle"}
                        {mismatch ? ` (only ${vehicle!.seats} seats)` : ""}
                        {d.status === "busy" ? " - busy" : ""}
                      </option>
                    );
                  })}
              </Select>
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1 !py-1.5 text-xs"
                  disabled={!manualDriverId || manualAssign.isPending}
                  onClick={handleManualAssign}
                >
                  Assign
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1 !py-1.5 text-xs"
                  onClick={() => {
                    setShowManualAssign(false);
                    setManualDriverId("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-muted">
                This skips the system's own suggestion - use it when you know something it doesn't.
              </p>
            </div>
          )}
        </div>
      )}

      {error && <p className="border-t border-line pt-2 text-xs font-medium text-signal">{error}</p>}
    </div>
  );
}
