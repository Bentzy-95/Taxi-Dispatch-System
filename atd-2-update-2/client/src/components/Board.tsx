import { useState } from "react";
import type { BookingStatusValue } from "../../../shared/schemas";
import { trpc } from "../lib/trpc";
import BookingCard from "./BookingCard";

const COLUMNS: { status: BookingStatusValue; number: string; label: string }[] = [
  { status: "unassigned", number: "01", label: "Unassigned" },
  { status: "assigned", number: "02", label: "Assigned" },
  { status: "en_route", number: "03", label: "En route" },
  { status: "completed", number: "04", label: "Done" },
];

export default function Board() {
  const bookingsQuery = trpc.bookings.list.useQuery();
  const recommendationsQuery = trpc.recommendations.pending.useQuery();
  const [error, setError] = useState<string | null>(null);
  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => bookingsQuery.refetch(),
    onError: (err) => setError(err.message),
  });
  const [dragOverColumn, setDragOverColumn] = useState<BookingStatusValue | null>(null);

  const bookings = bookingsQuery.data ?? [];
  const recommendationsByBookingId = new Map((recommendationsQuery.data ?? []).map((r) => [r.bookingId, r]));

  function handleDrop(status: BookingStatusValue, e: React.DragEvent) {
    e.preventDefault();
    setDragOverColumn(null);
    setError(null);
    const bookingId = Number(e.dataTransfer.getData("text/booking-id"));
    if (!bookingId) return;
    updateStatus.mutate({ bookingId, status });
  }

  return (
    <div>
      {error && <p className="mb-4 border border-signal bg-white px-3 py-2 text-sm font-medium text-signal">{error}</p>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {COLUMNS.map((col) => {
        const columnBookings = bookings.filter((b) => b.status === col.status);
        return (
          <div
            key={col.status}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverColumn(col.status);
            }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(col.status, e)}
            className={`min-h-[60vh] border border-line bg-panel p-3 transition-colors ${
              dragOverColumn === col.status ? "border-signal bg-white" : ""
            }`}
          >
            <div className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
              <span className="font-display text-lg font-800 text-signal">{col.number}</span>
              <h2 className="font-display text-sm font-700 uppercase tracking-wide">{col.label}</h2>
              <span className="ml-auto text-xs text-muted">{columnBookings.length}</span>
            </div>

            <div className="space-y-3">
              {columnBookings.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  recommendation={recommendationsByBookingId.get(booking.id)}
                  onDragStart={(e) => e.dataTransfer.setData("text/booking-id", String(booking.id))}
                />
              ))}
              {columnBookings.length === 0 && (
                <p className="py-6 text-center text-xs text-muted">Nothing here yet.</p>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
