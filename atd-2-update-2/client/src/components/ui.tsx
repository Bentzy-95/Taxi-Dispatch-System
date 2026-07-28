import clsx from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-ink text-paper hover:bg-signal",
        variant === "ghost" && "border border-line bg-paper text-ink hover:border-ink",
        variant === "danger" && "bg-signal text-signal-ink hover:bg-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "w-full border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-ink",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx("w-full border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-ink", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={clsx("mb-1 block text-xs font-semibold uppercase tracking-wide text-muted", className)}
      {...props}
    />
  );
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx("inline-block border border-line px-2 py-0.5 text-xs font-semibold uppercase tracking-wide", className)}
      {...props}
    />
  );
}
