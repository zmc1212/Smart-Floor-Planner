const { SESSION_STATES: S } = require('../core/session.js');

const ALL_STATES = Object.freeze(Object.values(S));
// Historical component-keyboard snapshots used this overlay alias. Accept it
// at the transition boundary; never emit it as a new session state.
const LEGACY_SESSION_STATE_ALIASES = Object.freeze({ openingSelected: S.WALL_SELECTED });
function rule(from, to) {
  return Object.freeze({ from: Object.freeze(from.slice()), to: Object.freeze(to.slice()) });
}

// Selection is an overlay; most commands are legal from any known state once
// their graph preconditions pass. Narrow input phases keep their original gates.
const SESSION_TRANSITIONS = Object.freeze({
  PREVIEW_STARTED: rule(ALL_STATES, [S.WALL_PREVIEW]),
  LENGTH_HELD: rule([S.WALL_PREVIEW], [S.AWAITING_LENGTH]),
  DIRECTION_LOCKED: rule(ALL_STATES, [S.AWAITING_LENGTH]),
  DIRECTION_CLEARED: rule([S.AWAITING_LENGTH], [S.IDLE, S.CURSOR_PLACED, S.WALL_COMMITTED]),
  ANGLE_PREVIEW_UPDATED: rule([S.WALL_PREVIEW], [S.AWAITING_LENGTH]),
  DIAGONAL_REOPENED: rule([S.WALL_COMMITTED], [S.AWAITING_LENGTH]),
  OBJECT_SELECTED: rule(ALL_STATES, [S.WALL_SELECTED]),
  WALL_SNAP_STARTED: rule(ALL_STATES, [S.WALL_SNAP_PENDING]),
  CURSOR_PLACED: rule(ALL_STATES, [S.CURSOR_PLACED, S.WALL_COMMITTED]),
  CURSOR_RESET: rule(ALL_STATES, [S.CURSOR_PLACED, S.WALL_COMMITTED, S.SPACE_CLOSED]),
  PENDING_CANCELLED: rule(ALL_STATES, [S.IDLE, S.CURSOR_PLACED, S.WALL_COMMITTED, S.SPACE_CLOSED]),
  REMEASURE_STARTED: rule(ALL_STATES, [S.REMEASURE_AWAITING_INPUT]),
  WALL_COMMITTED: rule([S.WALL_PREVIEW, S.AWAITING_LENGTH], [S.WALL_COMMITTED, S.CLOSING, S.MERGE_CLOSING]),
  CLOSURE_CANDIDATE_RESOLVED: rule(ALL_STATES, [S.WALL_COMMITTED, S.CLOSING, S.MERGE_CLOSING]),
  CLOSURE_COMPLETED: rule(ALL_STATES, [S.SPACE_CLOSED]),
  CLOSURE_JOINED: rule(ALL_STATES, [S.CLOSING]),
  OPEN_CHAIN_RESUMED: rule(ALL_STATES, [S.WALL_COMMITTED, S.CLOSING, S.MERGE_CLOSING]),
  WALL_DELETED: rule(ALL_STATES, [S.IDLE, S.CURSOR_PLACED, S.WALL_COMMITTED, S.SPACE_CLOSED, S.WALL_SELECTED]),
  REMEASURE_COMPLETED: rule(ALL_STATES, [S.WALL_COMMITTED, S.SPACE_CLOSED])
});

function evaluateSessionTransition(session, event, to) {
  const from = session && session.state;
  const canonicalFrom = Object.prototype.hasOwnProperty.call(LEGACY_SESSION_STATE_ALIASES, from)
    ? LEGACY_SESSION_STATE_ALIASES[from] : from;
  const contract = Object.prototype.hasOwnProperty.call(SESSION_TRANSITIONS, event)
    ? SESSION_TRANSITIONS[event] : null;
  if (!contract || !contract.from.includes(canonicalFrom) || !contract.to.includes(to)) {
    return {
      ok: false, from, event, to,
      error: { code: 'INVALID_SESSION_TRANSITION', details: { from, event, to } }
    };
  }
  return { ok: true, from, event, to };
}

// The pure decision above never mutates. Apply is restricted to an operation's
// working session or an interaction planner's isolated session copy.
function transitionSessionState(session, event, to) {
  const result = evaluateSessionTransition(session, event, to);
  if (!result.ok) {
    const error = new Error(result.error.code);
    error.code = result.error.code;
    error.details = result.error.details;
    throw error;
  }
  session.state = result.to;
  return session;
}

module.exports = { SESSION_TRANSITIONS, LEGACY_SESSION_STATE_ALIASES, evaluateSessionTransition, transitionSessionState };
