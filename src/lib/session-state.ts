/**
 * Explicit session lifecycle states from docs/architecture.md.
 * Milestone 0 only renders `idle`; later milestones drive the rest.
 */
export type SessionState =
  | "idle"
  | "requesting-permissions"
  | "camera-ready"
  | "connecting"
  | "active"
  | "paused"
  | "stopping"
  | "error";

export const SESSION_STATE_LABELS: Record<SessionState, string> = {
  idle: "Not started",
  "requesting-permissions": "Waiting for permission",
  "camera-ready": "Camera preview on",
  connecting: "Connecting",
  active: "Session active",
  paused: "Paused",
  stopping: "Stopping",
  error: "Error",
};
