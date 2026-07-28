import { FormEvent, useState } from "react";
import { trpc } from "../lib/trpc";
import { Button, Input, Label } from "./ui";

const initial = {
  passengerName: "",
  passengerPhone: "",
  passengerCount: "1",
  flightNumber: "",
  airportCode: "",
  scheduledTime: "",
  pickupLocation: "",
  dropoffLocation: "",
  estimatedDurationMinutes: "",
};

export default function BookingForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const create = trpc.bookings.create.useMutation({
    onSuccess: () => {
      utils.bookings.list.invalidate();
      utils.recommendations.pending.invalidate();
      setForm(initial);
      onCreated();
    },
    onError: (err) => setError(err.message),
  });

  function set<K extends keyof typeof initial>(key: K, value: (typeof initial)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate({
      ...form,
      passengerCount: Number(form.passengerCount),
      scheduledTime: new Date(form.scheduledTime),
      estimatedDurationMinutes: form.estimatedDurationMinutes ? Number(form.estimatedDurationMinutes) : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto grid max-w-5xl grid-cols-2 gap-4 md:grid-cols-4">
      <div className="col-span-2">
        <Label htmlFor="passengerName">Passenger name</Label>
        <Input
          id="passengerName"
          required
          value={form.passengerName}
          onChange={(e) => set("passengerName", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="passengerPhone">Phone</Label>
        <Input
          id="passengerPhone"
          required
          value={form.passengerPhone}
          onChange={(e) => set("passengerPhone", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="passengerCount">Passengers</Label>
        <Input
          id="passengerCount"
          type="number"
          min={1}
          max={16}
          required
          value={form.passengerCount}
          onChange={(e) => set("passengerCount", e.target.value)}
        />
      </div>

      <div className="col-span-2">
        <Label htmlFor="pickupLocation">Pickup location</Label>
        <Input
          id="pickupLocation"
          required
          value={form.pickupLocation}
          onChange={(e) => set("pickupLocation", e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <Label htmlFor="dropoffLocation">Dropoff location</Label>
        <Input
          id="dropoffLocation"
          required
          value={form.dropoffLocation}
          onChange={(e) => set("dropoffLocation", e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="scheduledTime">Pickup time</Label>
        <Input
          id="scheduledTime"
          type="datetime-local"
          required
          value={form.scheduledTime}
          onChange={(e) => set("scheduledTime", e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="flightNumber">Flight number (optional)</Label>
        <Input
          id="flightNumber"
          placeholder="Leave blank if not a flight"
          value={form.flightNumber}
          onChange={(e) => set("flightNumber", e.target.value.toUpperCase())}
        />
      </div>
      <div>
        <Label htmlFor="airportCode">Airport code (optional)</Label>
        <Input
          id="airportCode"
          placeholder="Leave blank if not airport-related"
          value={form.airportCode}
          onChange={(e) => set("airportCode", e.target.value.toUpperCase())}
        />
      </div>
      <div>
        <Label htmlFor="estimatedDurationMinutes">Trip duration, minutes (optional)</Label>
        <Input
          id="estimatedDurationMinutes"
          type="number"
          min={1}
          max={1440}
          placeholder="e.g. 180"
          value={form.estimatedDurationMinutes}
          onChange={(e) => set("estimatedDurationMinutes", e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">
          Lets us suggest reusing this driver for a nearby follow-on job once they're free
        </p>
      </div>

      <div className="col-span-2 flex items-end gap-3 md:col-span-4">
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Getting recommendation…" : "Submit & get recommendation"}
        </Button>
        {error && <p className="text-sm font-medium text-signal">{error}</p>}
      </div>
    </form>
  );
}
