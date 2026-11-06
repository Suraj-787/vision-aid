import { Icon } from "@/components/Icon";

/** The VisionAid mark: an eye on a teal tile with one amber spark. Decorative; the name sits beside it. */
export function Logo() {
  return (
    <span
      aria-hidden="true"
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm"
    >
      <Icon name="eye" size={1.2} />
      <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-background bg-accent" />
    </span>
  );
}
