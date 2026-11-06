"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
import type { CapturedImage } from "@/lib/image/capture";
import { describeQuality } from "@/lib/image/quality";

interface CapturedImageReviewProps {
  image: CapturedImage;
  canRetake: boolean;
  onRetake: () => void;
  /** Once a question is sent, the photo shrinks to a thumbnail on phones so the answer stays near the top. */
  compact?: boolean;
}

/** Review of the single captured still, with advisory (never blocking) quality tips. */
export function CapturedImageReview({ image, canRetake, onRetake, compact = false }: CapturedImageReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Mounted once per captured photo: move focus here so screen-reader users land on the result.
  useEffect(() => headingRef.current?.focus(), []);

  const advice = describeQuality(image.quality);

  return (
    <section aria-labelledby="photo-heading" className="rise space-y-3">
      <div className={compact ? "flex flex-row-reverse flex-wrap items-center justify-end gap-3 lg:block lg:space-y-3" : "space-y-3"}>
        <div className={compact ? "min-w-0 flex-1 basis-40 space-y-2 lg:flex lg:flex-wrap lg:items-center lg:justify-between lg:gap-3 lg:space-y-0" : "flex flex-wrap items-center justify-between gap-3"}>
          <h3 id="photo-heading" ref={headingRef} tabIndex={-1} className={`flex items-center gap-2 font-bold ${compact ? "text-lg lg:text-xl" : "text-xl"}`}>
            <Icon name="circle-check" className="text-primary" />
            Photo captured
          </h3>
          <ActionButton icon="rotate-ccw" onClick={onRetake} disabled={!canRetake}>
            Retake photo
          </ActionButton>
        </div>

        <div className={compact ? "viewfinder shrink-0 max-lg:!border-0 max-lg:!bg-transparent max-lg:!p-0 max-lg:before:hidden max-lg:after:hidden" : "viewfinder"}>
          <span className={compact ? "vf-corner-bl max-lg:hidden" : "vf-corner-bl"} aria-hidden="true" />
          <span className={compact ? "vf-corner-br max-lg:hidden" : "vf-corner-br"} aria-hidden="true" />
          {/* A blob: URL of a local capture; next/image does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="The photo you captured, shown for review. It has not been sent anywhere."
            width={image.width}
            height={image.height}
            className={
              compact
                ? "h-20 w-24 rounded-xl bg-surface object-cover lg:h-auto lg:max-h-[60vh] lg:w-full lg:object-contain"
                : "max-h-[60vh] w-full rounded-xl bg-surface object-contain"
            }
          />
        </div>
      </div>
      <p className={compact ? "text-caption text-muted max-lg:sr-only" : "text-caption text-muted"}>
        {image.width} × {image.height} pixels, {Math.max(1, Math.round(image.bytes / 1024))} KB JPEG.
        Kept on this device only.
      </p>

      {advice.length > 0 && !compact && (
        <div className="callout callout-warning">
          <Icon name="info" className="mt-0.5" />
          <div>
            <p className="font-bold">Photo quality tip</p>
            <ul className="list-disc space-y-1 pl-5">
              {advice.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
            <p className="text-caption">
              This is only a guess. You can still ask about this photo, or retake it.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
