"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import { CapturedImageReview } from "@/components/CapturedImageReview";
import { QuestionInput } from "@/components/QuestionInput";
import type { useAsk } from "@/hooks/useAsk";
import type { CameraStatus } from "@/hooks/useCamera";

type AskController = ReturnType<typeof useAsk>;

interface AskPanelProps {
  ask: AskController;
  cameraStatus: CameraStatus;
  onStartCamera: () => void;
  onStopCamera: () => void;
}

/**
 * The Tap-to-Ask controls: start camera -> capture -> review -> question -> Ask.
 * Frontend only in Milestone 4: "Ask" prepares the request locally and sends nothing.
 */
export function AskPanel({ ask, cameraStatus, onStartCamera, onStopCamera }: AskPanelProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cameraOn = cameraStatus === "camera-ready" || cameraStatus === "requesting-permissions";
  const busyCapturing = ask.phase === "capturing";

  const focusPrimary = () => requestAnimationFrame(() => primaryRef.current?.focus());

  return (
    <div className="space-y-4">
      {/* Spoken feedback for screen readers; visible state is shown elsewhere. */}
      <div role="status" aria-live="polite" className="sr-only">
        {ask.announcement}
      </div>

      {ask.captureError && (
        <p
          role="alert"
          className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground"
        >
          {ask.captureError}
        </p>
      )}

      {!ask.image ? (
        // Step 1-2: start the camera, then capture one photo.
        <div className="space-y-3">
          {cameraStatus === "camera-ready" ? (
            <ActionButton
              ref={primaryRef}
              large
              variant="primary"
              onClick={ask.capture}
              disabled={!ask.can.capture || busyCapturing}
            >
              {busyCapturing ? "Capturing…" : "Capture photo"}
            </ActionButton>
          ) : (
            <ActionButton
              ref={primaryRef}
              large
              variant="primary"
              onClick={onStartCamera}
              disabled={cameraStatus === "requesting-permissions"}
            >
              {cameraStatus === "requesting-permissions"
                ? "Waiting for camera permission…"
                : "Start camera"}
            </ActionButton>
          )}
          <p className="text-sm text-muted">
            {cameraStatus === "camera-ready"
              ? "Point the camera at what you want to ask about, then tap Capture photo."
              : "Step 1: start the camera. Then take one photo and ask a question about it."}
          </p>
        </div>
      ) : (
        <>
          <CapturedImageReview
            key={ask.image.url}
            image={ask.image}
            canRetake={ask.can.retake}
            onRetake={() => {
              ask.retake();
              focusPrimary();
            }}
          />

          {ask.phase === "ready-to-submit" ? (
            <RequestReady ask={ask} />
          ) : (
            <>
              <QuestionInput ask={ask} />
              <div className="space-y-2">
                <ActionButton
                  large
                  variant="primary"
                  onClick={ask.ask}
                  disabled={!ask.can.ask}
                  describedBy="ask-hint"
                >
                  Ask
                </ActionButton>
                <p id="ask-hint" className="text-sm text-muted">
                  {ask.askBlockedReason ?? "Ready. Tap Ask to prepare your request."}
                </p>
              </div>
            </>
          )}

        </>
      )}

      <div className="flex flex-wrap gap-3">
        {ask.image && (
          <ActionButton
            onClick={() => {
              ask.cancel();
              focusPrimary();
            }}
          >
            Cancel
          </ActionButton>
        )}
        {cameraOn && (
          <ActionButton onClick={onStopCamera} disabled={busyCapturing}>
            Stop camera
          </ActionButton>
        )}
      </div>

      <p className="text-sm text-muted">
        Your photo and typed question stay on this device in this version. Nothing is sent to an AI
        service yet.
      </p>
    </div>
  );
}

/** The local "request is ready" state shown after Ask. Nothing is transmitted. */
function RequestReady({ ask }: { ask: AskController }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section
      aria-labelledby="ready-heading"
      className="space-y-3 rounded-lg border-2 border-accent bg-surface p-4"
    >
      <h3 id="ready-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Request ready
      </h3>
      <p>
        Your photo
        {ask.prepared ? ` (${ask.prepared.width} × ${ask.prepared.height})` : ""} and your question
        are prepared on this device:
      </p>
      <blockquote className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-lg">
        {ask.prepared?.question}
      </blockquote>
      <p className="font-semibold">
        Nothing has been sent. Asking the AI is not available in this version.
      </p>
      <ActionButton onClick={ask.edit}>Edit question</ActionButton>
    </section>
  );
}
