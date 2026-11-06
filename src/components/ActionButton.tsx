import type { ReactNode, Ref } from "react";
import { Icon, type IconName } from "@/components/Icon";

interface ActionButtonProps {
  children: ReactNode;
  onClick: () => void;
  /** Uses aria-disabled (not `disabled`) so the button stays focusable and keeps its place. */
  disabled?: boolean;
  /** primary: the one main action; secondary: supporting; quiet: low emphasis. */
  variant?: "primary" | "secondary" | "quiet";
  /** Full-width, taller target for the main action. */
  large?: boolean;
  /** A decorative icon before the label (the label always carries the meaning). */
  icon?: IconName;
  describedBy?: string;
  /** Called when a disabled button is activated anyway, so the person hears why nothing happened. */
  onBlockedClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

export function ActionButton({
  children,
  onClick,
  disabled = false,
  variant = "secondary",
  large = false,
  icon,
  describedBy,
  onBlockedClick,
  ref,
}: ActionButtonProps) {
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={disabled}
      aria-describedby={describedBy}
      onClick={() => {
        if (!disabled) onClick();
        else onBlockedClick?.();
      }}
      className={`btn btn-${variant} ${large ? "btn-large" : ""}`}
    >
      {icon && <Icon name={icon} size={large ? 1.1 : 1} />}
      <span>{children}</span>
    </button>
  );
}
