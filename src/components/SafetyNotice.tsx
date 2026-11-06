import { Icon } from "@/components/Icon";

/**
 * Always-visible limit, in one sentence; the full list is one tap away. This is a
 * calm amber strip (not an alarm), but it is never hidden behind a click.
 */
export function SafetyNotice() {
  return (
    <section aria-labelledby="safety-heading" className="callout callout-warning !flex-col !gap-0 !py-3">
      <div className="flex items-start gap-3">
        <Icon name="triangle-alert" size={1.1} className="mt-0.5" />
        <div>
          <h2 id="safety-heading" className="text-base font-bold">
            Not a safety or navigation tool
          </h2>
          <p className="text-caption">
            VisionAid can be wrong and cannot tell whether a road, crossing, stairway or path is
            safe or clear. Keep relying on your cane, guide dog or trusted help.
          </p>
        </div>
      </div>
      <details className="sm:ml-9">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-caption font-bold underline underline-offset-4">
          What VisionAid will not do
          <Icon name="chevron-down" size={0.9} className="chevron" />
        </summary>
        <ul className="list-disc space-y-1 pb-1 pl-5 text-caption">
          <li>Do not use it to decide where to walk, step or cross.</li>
          <li>
            It does not replace a white cane, a guide dog, orientation and mobility training, or a
            human guide.
          </li>
          <li>It does not give medical advice, doses, or say whether a medicine suits you.</li>
          <li>It cannot tell whether a banknote is genuine or counterfeit.</li>
        </ul>
      </details>
    </section>
  );
}
