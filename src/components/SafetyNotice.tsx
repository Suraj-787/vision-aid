export function SafetyNotice() {
  return (
    <section
      aria-labelledby="safety-heading"
      className="rounded-lg border-2 border-warning-border bg-warning-bg p-4 text-warning-foreground sm:p-5"
    >
      <h2 id="safety-heading" className="text-lg font-bold">
        Important: not a safety or navigation tool
      </h2>
      <p className="mt-2">
        VisionAid is an experimental information assistant. It can be wrong, and
        it cannot reliably tell whether a road, crossing, stairway, doorway or
        path is safe or clear.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Do not use it to decide where to walk, step or cross.</li>
        <li>
          It does not replace a white cane, a guide dog, orientation and
          mobility training, or a human guide.
        </li>
        <li>
          For anything safety-related, rely on your established mobility aids
          and trusted assistance.
        </li>
      </ul>
    </section>
  );
}
