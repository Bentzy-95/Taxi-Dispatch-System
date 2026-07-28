import { useState } from "react";
import BookingForm from "../components/BookingForm";
import Board from "../components/Board";
import FleetPanel from "../components/FleetPanel";
import { trpc } from "../lib/trpc";
import { useLiveUpdates } from "../lib/useLiveUpdates";

type Tab = "booking" | "fleet";

export default function Dispatch() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("booking");

  useLiveUpdates(() => {
    utils.bookings.list.invalidate();
    utils.recommendations.pending.invalidate();
    utils.drivers.list.invalidate();
  });

  return (
    <div className="min-h-screen bg-paper">
      <header className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-signal">Airport Transfers</p>
          <h1 className="font-display text-3xl font-800 leading-none">Dispatch</h1>
        </div>
        <nav className="flex gap-2">
          <button
            onClick={() => setTab("booking")}
            className={`border px-4 py-2 text-sm font-semibold uppercase tracking-wide ${
              tab === "booking" ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"
            }`}
          >
            New booking
          </button>
          <button
            onClick={() => setTab("fleet")}
            className={`border px-4 py-2 text-sm font-semibold uppercase tracking-wide ${
              tab === "fleet" ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink"
            }`}
          >
            Fleet setup
          </button>
        </nav>
      </header>

      <div className="border-b border-line bg-panel px-6 py-6">
        {tab === "booking" ? <BookingForm onCreated={() => setTab("booking")} /> : <FleetPanel />}
      </div>

      <main className="px-6 py-6">
        <Board />
      </main>
    </div>
  );
}
