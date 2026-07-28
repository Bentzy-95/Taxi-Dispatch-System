
import { format } from "date-fns";
import { Phone } from "lucide-react";
import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "../lib/trpc";
import { useLiveUpdates } from "../lib/useLiveUpdates";
import { Button } from "../components/ui";

const GROUP_COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

function colorForGroup(groupId: string) {
  let hash = 0;
  for (let i = 0; i < groupId.length; i++) {
    hash = (hash * 31 + groupId.charCodeAt(i)) % GROUP_COLORS.length;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

export default function DriverView() {
  const { token } = useParams<{ token: string }>();
  const utils = trpc.useUtils();
  const jobsQuery = trpc.drivers.jobs.useQuery({ token: token! }, { enabled: !!token });
  const [error, setError] = useState<string | null>(null);
  const updateStatus = trpc.bookings.updateStatus.useMutation({
    onSuccess: () => utils.drivers.jobs.invalidate({ token }),
    onError: (err) => setError(err.message),
  });
  useLiveUpdates(() => utils.drivers.jobs.invalidate({ token }), token);
  if (jobsQuery.isLoading) {
    return <div className="p-6 text-sm text-muted">Loading your jobs…</div>;
  }
  if (jobsQuery.isError) {
    return (
      <div className="p-6 text-sm text-signal">
        This driver link isn't recognized. Check the link your dispatcher sent you.
      </div>
    );
  }
  const jobs = jobsQuery.data?.jobs ?? [];
  const driver = jobsQuery.data?.driver;
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-signal">Your jobs</p>
        <h1 className="font-display text-2xl font-800">{driver?.name}</h1>
      </header>
      <main className="space-y-3 p-5">
        {jobs.length === 0 && <p className="text-sm text-muted">No active jobs right now.</p>}
        {jobs.length > 1 && (
          <p className="border border-signal bg-white px-3 py-2 text-xs font-semibold text-signal">
            {jobs.length} passengers combined into one trip — pick each one up in order below.
          </p>
        )}
        {jobs.map((job, i) => {
          const groupColor = job.groupId ? colorForGroup(job.groupId) : null;
          return (
            <div
              key={job.id}
              className="space-y-2 border border-line p-4"
              style={
                groupColor
                  ? { borderLeft: `6px solid ${groupColor}`, backgroundColor: `${groupColor}0d` }
                  : undefined
              }
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted">Stop {i + 1}</p>
                  <p className="font-display text-lg font-700">{job.passengerName}</p>
                  {groupColor && (
                    <span
                      className="mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                      style={{ backgroundColor: groupColor }}
                    >
                      Combined trip
                    </span>
                  )}
                </div>
                <a href={`tel:${job.passengerPhone}`} className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
                  <Phone className="h-4 w-4" /> Call
                </a>
              </div>
              <p className="text-sm">{format(new Date(job.scheduledTime), "d MMM, HH:mm")}</p>
              <div className="space-y-0.5 text-sm">
                <p>
                  <span className="text-muted">Pickup </span>
                  {job.pickupLocation}
                </p>
                <p>
                  <span className="text-muted">Dropoff </span>
                  {job.dropoffLocation}
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                {job.status === "assigned" && (
                  <Button
                    className="flex-1"
                    onClick={() => updateStatus.mutate({ bookingId: job.id, status: "en_route", driverToken: token })}
                    disabled={updateStatus.isPending}
                  >
                    I'm on the way
                  </Button>
                )}
                {job.status === "en_route" && (
                  <Button
                    className="flex-1"
                    variant="danger"
                    onClick={() => updateStatus.mutate({ bookingId: job.id, status: "completed", driverToken: token })}
                    disabled={updateStatus.isPending}
                  >
                    Completed
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {error && <p className="border border-signal bg-white px-3 py-2 text-sm font-medium text-signal">{error}</p>}
      </main>
    </div>
  );
}
