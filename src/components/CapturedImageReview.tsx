"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import type { CapturedImage } from "@/lib/image/capture";
import { describeQuality } from "@/lib/image/quality";

interface CapturedImageReviewProps {
  image: CapturedImage;
  canRetake: boolean;
  onRetake: () => void;
}

/** Review of the single captured still, with advisory (never blocking) quality tips. */
export function CapturedImageReview({ image, canRetake, onRetake }: CapturedImageReviewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Mounted once per captured photo: move focus here so screen-reader users land on the result.
  useEffect(() => headingRef.current?.focus(), []);

  const advice = describeQuality(image.quality);

  return (
    <section aria-labelledby="photo-heading" className="space-y-3">
      <h3 id="photo-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Photo captured
      </h3>

      {/* A blob: URL of a local capture; next/image does not apply. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt="The photo you captured, shown for review. It has not been sent anywhere."
        width={image.width}
        height={image.height}
        className="max-h-[60vh] w-full rounded-lg border-2 border-border bg-surface object-contain"
      />
      <p className="text-sm text-muted">
        {image.width} × {image.height} pixels, {Math.max(1, Math.round(image.bytes / 1024))} KB
        JPEG. Kept on this device only.
      </p>

      {advice.length > 0 && (
        <div className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground">
          <p className="font-semibold">Photo quality tip</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {advice.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <p className="mt-2 text-sm">
            This is only a guess. You can still ask about this photo, or retake it.
          </p>
        </div>
      )}

      <ActionButton onClick={onRetake} disabled={!canRetake}>
        Retake photo
      </ActionButton>
    </section>
  );
}
