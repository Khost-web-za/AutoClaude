import type { SessionGitState } from '@/db/schema';

/** Why a session action was refused. Client-safe (types only). */
export type SessionFailureReason =
  | 'capacity'
  | 'disk'
  | 'sysbox'
  | 'blocked'
  | 'invalid'
  | 'not-found'
  | 'unavailable';

export type SessionFailure = {
  ok: false;
  reason: SessionFailureReason;
  /** Safe to show: never a secret, a Docker or database error text, or a stack. */
  message: string;
  fieldErrors?: Record<string, string[]>;
};

/** Delete refused: the workspace has unpushed, uncommitted or unknown work, so the repo name must be typed. */
export type DeleteNeedsConfirmation = {
  ok: false;
  reason: 'needs-confirmation';
  needsConfirmation: true;
  gitState: SessionGitState;
  message: string;
};

export type SessionActionResult = { ok: true; message: string } | SessionFailure;
export type StartSessionResult = { ok: true; sessionId: string } | SessionFailure;
export type DeleteSessionResult = SessionActionResult | DeleteNeedsConfirmation;
export type WorkStateResult = { ok: true; gitState: SessionGitState } | SessionFailure;
