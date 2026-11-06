"use client";

import { useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import { AnswerView } from "@/components/AnswerView";
import { SendFailure, SendingView } from "@/components/AskProgress";
import { CapturedImageReview } from "@/components/CapturedImageReview";
import { LanguageSelector } from "@/components/LanguageSelector";
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
 * The Tap-to-Ask controls: start camera -> capture -> review -> question -> Ask
 * -> (sending) -> answer. Tapping Ask is the only thing that sends anything: it
 * sends the already-captured photo and the question to the server.
 */
export function AskPanel({ ask, cameraStatus, onStartCamera, onStopCamera }: AskPanelProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cameraOn = cameraStatus === "camera-ready" || cameraStatus === "requesting-permissions";
  const busyCapturing = ask.phase === "capturing";

  const focusPrimary = () => requestAnimationFrame(() => primaryRef.current?.focus());

  const answered = ask.phase === "answered" && ask.result !== null;
  const failed = ask.phase === "send-failed" && ask.sendError !== null;
  const sending = ask.phase === "sending";

  return (
    <div className="space-y-4">
      {/* Spoken feedback for screen readers; visible state is shown elsewhere. */}
      <div role="status" aria-live="polite" className="sr-only">
        {ask.announcement}
      </div>

      <LanguageSelector ask={ask} />

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

          {sending && <SendingView question={ask.question.trim()} />}

          {answered && ask.result && (
            <AnswerView
              result={ask.result}
              onAskAnother={ask.askAnother}
              output={ask.output}
              onListen={ask.listenToAnswer}
              languageNotes={ask.answerLanguageNotes}
            />
          )}

          {failed && ask.sendError && (
            <SendFailure
              error={ask.sendError}
              canRetry={ask.can.retry}
              onRetry={ask.retry}
              onEdit={ask.edit}
            />
          )}

          {!sending && !answered && !failed && (
            <>
              <QuestionInput ask={ask} />
              <div className="space-y-2">
                <ActionButton
                  large
                  variant="primary"
                  onClick={ask.ask}
                  disabled={!ask.can.ask}
                  describedBy="ask-hint ask-disclosure"
                >
                  Ask
                </ActionButton>
                <p id="ask-hint" className="text-sm text-muted">
                  {ask.askBlockedReason ?? "Ready. Tap Ask to get an answer."}
                </p>
                <p id="ask-disclosure" className="text-sm">
                  When you tap Ask, this photo and your question are sent to Google&apos;s Gemini
                  service, through VisionAid&apos;s server, to get an answer. Nothing is sent
                  before then, and VisionAid does not store them.
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
            {answered ? "Done" : "Cancel"}
          </ActionButton>
        )}
        {cameraOn && (
          <ActionButton onClick={onStopCamera} disabled={busyCapturing}>
            Stop camera
          </ActionButton>
        )}
      </div>

      <p className="text-sm text-muted">
        Your photo and question stay on this device until you tap Ask. VisionAid does not save
        them.
      </p>
    </div>
  );
}
