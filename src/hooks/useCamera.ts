"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cameraError,
  toCameraError,
  type CameraError,
} from "@/lib/camera-errors";
import { describeError, devLog } from "@/lib/dev-log";
import type { SessionState } from "@/lib/session-state";

export type CameraStatus = Extract<
  SessionState,
  "idle" | "requesting-permissions" | "camera-ready" | "error"
>;

/**
 * Local camera preview only (Milestone 1). Video only, no microphone, and the
 * stream is attached to a <video> element: frames are never read, copied,
 * recorded or sent anywhere.
 *
 * Every path that ends the preview (stop, error, track ended, pagehide,
 * unmount) goes through releaseStream(), which stops every track.
 */
export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Incremented whenever a request is started or cancelled, so a getUserMedia
  // call that resolves after Stop/unmount can detect it is stale.
  const requestIdRef = useRef(0);
  const requestingRef = useRef(false);

  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<CameraError | null>(null);

  const releaseStream = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) devLog("camera", `releasing ${stream.getTracks().length} track(s)`);
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }, []);

  const cancelPending = useCallback(() => {
    requestIdRef.current += 1;
    requestingRef.current = false;
  }, []);

  const fail = useCallback(
    (err: CameraError, cause?: unknown) => {
      devLog("camera", `failed: ${err.kind}`, cause && describeError(cause));
      cancelPending();
      releaseStream();
      setError(err);
      setStatus("error");
    },
    [cancelPending, releaseStream],
  );

  const stop = useCallback(() => {
    devLog("camera", "stop requested");
    cancelPending();
    releaseStream();
    setError(null);
    setStatus("idle");
  }, [cancelPending, releaseStream]);

  const start = useCallback(async () => {
    devLog("camera", "start requested");
    if (streamRef.current || requestingRef.current) {
      devLog("camera", "start ignored: already starting or running");
      return;
    }

    if (!window.isSecureContext) return fail(cameraError("insecure-context"));
    if (!navigator.mediaDevices?.getUserMedia) {
      return fail(cameraError("unsupported"));
    }

    const id = ++requestIdRef.current;
    requestingRef.current = true;
    setError(null);
    setStatus("requesting-permissions");
    devLog("camera", "calling getUserMedia (video only)");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Video only: the microphone is never requested here. Without a size,
        // phones usually return a 640x480 stream, too small for fine print;
        // these are ideals, so a device that cannot match them still works.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      // Stopped, unmounted or restarted while the permission prompt was open.
      if (id !== requestIdRef.current) {
        devLog("camera", "stale request resolved; stopping its tracks");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      devLog("camera", `permission granted; ${stream.getTracks().length} track(s)`);
      // Page was hidden while the permission prompt was open: do not start.
      if (document.visibilityState === "hidden") {
        stream.getTracks().forEach((track) => track.stop());
        fail(cameraError("page-hidden"));
        return;
      }
      streamRef.current = stream;
      requestingRef.current = false;
      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          if (streamRef.current === stream) fail(cameraError("disconnected"));
        };
      });

      const video = videoRef.current;
      if (!video) throw new Error("Video element missing");
      video.srcObject = stream;
      await video.play();

      if (id === requestIdRef.current) {
        devLog("camera", "preview playing");
        setStatus("camera-ready");
      }
    } catch (err) {
      if (id !== requestIdRef.current) return;
      fail(toCameraError(err), err);
    }
  }, [fail]);

  useEffect(() => {
    // Leaving the page (including bfcache) must not leave the camera on.
    // Switching apps or locking the screen fires visibilitychange, not
    // pagehide, so a hidden page also turns the camera off (mobile browsers
    // do not reliably keep it running in the background, and it must not run
    // unseen).
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && streamRef.current) {
        fail(cameraError("page-hidden"));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      // Unmount: cancel any pending request and stop all tracks. No setState.
      cancelPending();
      releaseStream();
    };
  }, [stop, fail, cancelPending, releaseStream]);

  return { videoRef, status, error, start, stop };
}
