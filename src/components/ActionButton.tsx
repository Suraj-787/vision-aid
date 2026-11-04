import type { ReactNode, Ref } from "react";

interface ActionButtonProps {
  children: ReactNode;
  onClick: () => void;
  /** Uses aria-disabled (not `disabled`) so the button stays focusable and keeps its place. */
  disabled?: boolean;
  variant?: "primary" | "secondary";
  /** Large, full-width tap target for the main action. */
  large?: boolean;
  describedBy?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = "secondary",
  large = false,
  describedBy,
  ref,
}: ActionButtonProps) {
  const size = large ? "min-h-16 w-full px-6 py-4 text-xl font-bold" : "min-h-12 px-5 py-3 text-base font-semibold";
  const color =
    variant === "primary"
      ? "border-accent bg-accent text-accent-foreground"
      : "border-border bg-background text-foreground";

  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={disabled}
      aria-describedby={describedBy}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`rounded-xl border-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${size} ${color}`}
    >
      {children}
    </button>
  );
}
