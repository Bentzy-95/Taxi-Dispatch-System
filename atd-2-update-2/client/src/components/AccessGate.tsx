import { FormEvent, ReactNode, useState } from "react";
import { trpc } from "../lib/trpc";
import { Button, Input } from "./ui";

export default function AccessGate({ children }: { children: ReactNode }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const check = trpc.auth.check.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();

  if (check.isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading…</div>;
  }

  if (check.isSuccess) {
    return <>{children}</>;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    localStorage.setItem("atd_access_code", code);
    setError(null);
    check.refetch().then((result) => {
      if (result.isError) {
        setError("That passcode isn't right.");
      } else {
        utils.invalidate();
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-3 border border-line p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-signal">Airport Transfers</p>
        <h1 className="font-display text-2xl font-800">Dispatch</h1>
        <p className="text-sm text-muted">Enter the dispatch passcode to continue.</p>
        <Input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Passcode"
        />
        <Button type="submit" className="w-full">
          Continue
        </Button>
        {error && <p className="text-sm font-medium text-signal">{error}</p>}
      </form>
    </div>
  );
}
