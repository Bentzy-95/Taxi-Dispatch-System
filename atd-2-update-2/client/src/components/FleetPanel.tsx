import { FormEvent, useState } from "react";
import { Copy, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { trpc } from "../lib/trpc";
import { Button, Input, Label, Select } from "./ui";

export default function FleetPanel() {
  const utils = trpc.useUtils();
  const vehiclesQuery = trpc.vehicles.list.useQuery();
  const driversQuery = trpc.drivers.list.useQuery();
  const [error, setError] = useState<string | null>(null);

  const [vehicleName, setVehicleName] = useState("");
  const [vehicleSeats, setVehicleSeats] = useState("4");
  const createVehicle = trpc.vehicles.create.useMutation({
    onSuccess: () => {
      utils.vehicles.list.invalidate();
      setVehicleName("");
      setVehicleSeats("4");
    },
  });
  const deleteVehicle = trpc.vehicles.delete.useMutation({
    onSuccess: () => utils.vehicles.list.invalidate(),
    onError: (err) => setError(err.message),
  });

  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [driverVehicleId, setDriverVehicleId] = useState("");
  const createDriver = trpc.drivers.create.useMutation({
    onSuccess: () => {
      utils.drivers.list.invalidate();
      setDriverName("");
      setDriverPhone("");
      setDriverVehicleId("");
    },
  });
  const deleteDriver = trpc.drivers.delete.useMutation({
    onSuccess: () => utils.drivers.list.invalidate(),
    onError: (err) => setError(err.message),
  });

  function submitVehicle(e: FormEvent) {
    e.preventDefault();
    createVehicle.mutate({ name: vehicleName, seats: Number(vehicleSeats) });
  }

  function submitDriver(e: FormEvent) {
    e.preventDefault();
    createDriver.mutate({
      name: driverName,
      phone: driverPhone,
      vehicleId: driverVehicleId ? Number(driverVehicleId) : undefined,
    });
  }

  function removeVehicle(vehicleId: number, name: string) {
    setError(null);
    if (!window.confirm(`Remove ${name}? This can't be undone.`)) return;
    deleteVehicle.mutate({ vehicleId });
  }

  function removeDriver(driverId: number, name: string) {
    setError(null);
    if (!window.confirm(`Remove ${name}? Their link will stop working. This can't be undone.`)) return;
    deleteDriver.mutate({ driverId });
  }

  const regenerateLink = trpc.drivers.regenerateLink.useMutation({
    onSuccess: () => utils.drivers.list.invalidate(),
  });

  function copyLink(token: string) {
    const url = `${window.location.origin}/driver/${token}`;
    navigator.clipboard.writeText(url);
  }

  function regenerate(driverId: number, name: string) {
    if (
      !window.confirm(
        `Regenerate ${name}'s link? Their old link will stop working immediately - you'll need to send them the new one.`,
      )
    ) {
      return;
    }
    regenerateLink.mutate({ driverId });
  }

  const vehicles = vehiclesQuery.data ?? [];
  const drivers = driversQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl">
      {error && (
        <p className="mb-4 border border-signal bg-white px-3 py-2 text-sm font-medium text-signal">{error}</p>
      )}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
      <div>
        <h3 className="mb-3 font-display text-sm font-700 uppercase tracking-wide">Vehicles</h3>
        <form onSubmit={submitVehicle} className="mb-3 flex gap-2">
          <Input placeholder="Name, e.g. Mercedes E-Class" value={vehicleName} onChange={(e) => setVehicleName(e.target.value)} required />
          <Input
            type="number"
            min={1}
            max={64}
            className="w-24"
            value={vehicleSeats}
            onChange={(e) => setVehicleSeats(e.target.value)}
            required
          />
          <Button type="submit" disabled={createVehicle.isPending}>
            Add
          </Button>
        </form>
        <ul className="space-y-1 text-sm">
          {vehicles.map((v) => (
            <li key={v.id} className="flex items-center justify-between border-b border-line py-1">
              <span>{v.name}</span>
              <span className="flex items-center gap-3">
                <span className="text-muted">{v.seats} seats</span>
                <button
                  type="button"
                  onClick={() => removeVehicle(v.id, v.name)}
                  disabled={deleteVehicle.isPending}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-signal"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-3 font-display text-sm font-700 uppercase tracking-wide">Drivers</h3>
        <form onSubmit={submitDriver} className="mb-3 space-y-2">
          <div className="flex gap-2">
            <Input placeholder="Name" value={driverName} onChange={(e) => setDriverName(e.target.value)} required />
            <Input placeholder="Phone" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <Select value={driverVehicleId} onChange={(e) => setDriverVehicleId(e.target.value)}>
              <option value="">No vehicle assigned</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.seats} seats)
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={createDriver.isPending}>
              Add
            </Button>
          </div>
        </form>
        <ul className="space-y-1 text-sm">
          {drivers.map((d) => (
            <li key={d.id} className="flex items-center justify-between border-b border-line py-1">
              <span>
                {d.name} <span className="text-muted">· {d.status}</span>
                {!d.vehicleId && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-signal">
                    <TriangleAlert className="h-3.5 w-3.5" /> No vehicle - won't receive job suggestions
                  </span>
                )}
              </span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => copyLink(d.token)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-ink hover:text-signal"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy link
                </button>
                <button
                  type="button"
                  onClick={() => regenerate(d.id, d.name)}
                  disabled={regenerateLink.isPending}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-signal"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => removeDriver(d.id, d.name)}
                  disabled={deleteDriver.isPending}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-signal"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      </div>
    </div>
  );
}
