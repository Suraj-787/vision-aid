"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ActionButton } from "@/components/ActionButton";
import { AnswerView } from "@/components/AnswerView";
import { SendFailure, SendingView } from "@/components/AskProgress";
import { CapturedImageReview } from "@/components/CapturedImageReview";
import { Icon } from "@/components/Icon";
import { LanguageSelector } from "@/components/LanguageSelector";
import { QuestionInput } from "@/components/QuestionInput";
import type { useAsk } from "@/hooks/useAsk";
import type { CameraStatus } from "@/hooks/useCamera";
import { blockedActionAnnouncement } from "@/lib/a11y/messages";

type AskController = ReturnType<typeof useAsk>;

interface AskPanelProps {
  ask: AskController;
  cameraStatus: CameraStatus;
  onStartCamera: () => void;
  onStopCamera: () => void;
  /** The camera preview. Always mounted (the camera hook attaches the stream to it); hidden while a photo is shown. */
  preview: ReactNode;
}

/**
 * The Tap-to-Ask controls: start camera -> capture -> review -> question -> Ask
 * -> (sending) -> answer. Tapping Ask is the only thing that sends anything: it
 * sends the already-captured photo and the question to the server.
 *
 * Layout: one column on phones, in the order a person works. From the lg breakpoint
 * the picture (camera, then the captured photo) stays on the left while the question
 * and the answer use the right, so the photo is visible next to its answer.
 */
export function AskPanel({ ask, cameraStatus, onStartCamera, onStopCamera, preview }: AskPanelProps) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const cameraOn = cameraStatus === "camera-ready" || cameraStatus === "requesting-permissions";
  const busyCapturing = ask.phase === "capturing";

  const focusPrimary = () => requestAnimationFrame(() => primaryRef.current?.focus());

  // Focus moves only when the person's own action asks for it (Ask another question, Edit
  // question, the spoken "ask" command), never for a status update.
  const { focusRequest } = ask;
  useEffect(() => {
    if (focusRequest.target === "question") document.getElementById("question-heading")?.focus();
    else if (focusRequest.target === "ask") askButtonRef.current?.focus();
  }, [focusRequest]);

  const answered = ask.phase === "answered" && ask.result !== null;
  const failed = ask.phase === "send-failed" && ask.sendError !== null;
  const sending = ask.phase === "sending";

  return (
    <div className="space-y-5">
      {/* Spoken feedback for screen readers; visible state is shown elsewhere. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {ask.announcement}
      </div>

      {ask.captureError && (
        <div role="alert" className="callout callout-danger">
          <Icon name="triangle-alert" className="mt-0.5" />
          <p>{ask.captureError}</p>
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-4 lg:sticky lg:top-6">
          <div hidden={ask.image !== null}>{preview}</div>
          {ask.image && (
            <CapturedImageReview
              key={ask.image.url}
              image={ask.image}
              compact={sending || answered || failed}
              canRetake={ask.can.retake}
              onRetake={() => {
                ask.retake();
                focusPrimary();
              }}
            />
          )}
        </div>

        <div className="min-w-0 space-y-5">
          {!ask.image ? (
            // Step 1-2: start the camera, then capture one photo.
            <div className="space-y-3 lg:pt-4">
              {cameraStatus === "camera-ready" ? (
                <ActionButton
                  ref={primaryRef}
                  large
                  variant="primary"
                  icon="camera"
                  onClick={ask.capture}
                  disabled={!ask.can.capture || busyCapturing}
                  onBlockedClick={() => ask.notify(busyCapturing ? "Capturing the photo. Please wait." : "The camera is not ready yet. Wait until it is on.")}
                >
                  {busyCapturing ? "Capturing…" : "Capture photo"}
                </ActionButton>
              ) : (
                <ActionButton
                  ref={primaryRef}
                  large
                  variant="primary"
                  icon="camera"
                  onClick={onStartCamera}
                  disabled={cameraStatus === "requesting-permissions"}
                >
                  {cameraStatus === "requesting-permissions"
                    ? "Waiting for camera permission…"
                    : "Start camera"}
                </ActionButton>
              )}
              <p className="text-muted">
                {cameraStatus === "camera-ready"
                  ? "Point the camera at what you want to ask about, then tap Capture photo."
                  : "Take one photo, then ask a question about it by speaking or typing."}
              </p>
            </div>
          ) : (
            <>
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
                <div className="rise space-y-5">
                  <LanguageSelector ask={ask} />
                  <QuestionInput ask={ask} />
                  <div className="space-y-2">
                    <ActionButton
                      ref={askButtonRef}
                      large
                      variant="primary"
                      icon="send"
                      onClick={ask.ask}
                      disabled={!ask.can.ask}
                      describedBy="ask-hint ask-disclosure"
                      onBlockedClick={() => ask.notify(blockedActionAnnouncement(ask.askBlockedReason, "Ask is not available yet."))}
                    >
                      Ask
                    </ActionButton>
                    <p id="ask-hint" className={ask.askBlockedReason ? "text-caption text-muted" : "sr-only"}>
                      {ask.askBlockedReason ?? "Ready. Tap Ask to get an answer."}
                    </p>
                    <p id="ask-disclosure" className="flex items-start gap-2 text-caption">
                      <Icon name="lock" size={0.9} className="mt-0.5 text-primary" />
                      <span>
                        Ask sends this photo and your question to Google&apos;s Gemini service,
                        through VisionAid&apos;s server. Nothing is sent before then, and VisionAid
                        does not store them.
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {(ask.image !== null || cameraOn) && (
            <div className="flex flex-wrap gap-3">
              {ask.image && (
                <ActionButton
                  icon="x"
                  onClick={() => {
                    ask.cancel();
                    focusPrimary();
                  }}
                >
                  {answered ? "Done" : "Cancel"}
                </ActionButton>
              )}
              {cameraOn && (
                <ActionButton variant="quiet" onClick={onStopCamera} disabled={busyCapturing}>
                  Stop camera
                </ActionButton>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
