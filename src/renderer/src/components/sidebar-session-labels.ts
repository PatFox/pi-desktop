import type { AgentEngineKind, SessionListItem } from '../../../shared/ipc-contracts'
import { getSessionTitle } from '../utils/session-title'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { DEFAULT_OMP_PROFILE_NAME } from '../../../shared/omp-profile'

type SessionRowLabelInput = Pick<
  SessionListItem,
  'name' | 'preview' | 'sessionId' | 'projectName' | 'projectPath'
>

type SessionEngineInput = Pick<SessionListItem, 'engine'>

interface SessionRowLabels {
  title: string
  subtitle: string | null
}

export function getSessionRowLabels(session: SessionRowLabelInput): SessionRowLabels {
  const subtitle = session.projectName.trim()

  return {
    title: getSessionTitle(session.name, session.sessionId, session.preview),
    subtitle: subtitle || null,
  }
}

/**
 * Tag naming the engine a session belongs to, or null when the main process
 * could not classify it. An unlabelled row is left untagged rather than being
 * guessed into one engine — the two are not interchangeable.
 */
export function getSessionEngineLabel(session: SessionEngineInput): string | null {
  return agentEngineLabel(session.engine)
}

/**
 * True when the sessions come from more than one engine. With a single engine
 * on screen the tag names what everything already is, so it is only noise.
 */
export function hasMixedSessionEngines(sessions: readonly SessionEngineInput[]): boolean {
  let seen: AgentEngineKind | null = null
  for (const session of sessions) {
    if (!session.engine) continue
    if (seen === null) seen = session.engine
    else if (seen !== session.engine) return true
  }
  return false
}

type SessionProfileInput = Pick<SessionListItem, 'engine' | 'ompProfile'>

/**
 * Tag naming the OMP profile (account) a session belongs to, or null for a
 * session of another engine. Default-profile sessions are tagged `default`,
 * so beside a named profile they do not read as unlabelled.
 */
export function getSessionProfileLabel(session: SessionProfileInput): string | null {
  if (session.engine !== 'omp') return null
  return session.ompProfile ?? DEFAULT_OMP_PROFILE_NAME
}

/**
 * True when the OMP sessions come from more than one profile (the default
 * profile counts as one). With a single account on screen the tag is noise.
 */
export function hasMixedOmpProfiles(sessions: readonly SessionProfileInput[]): boolean {
  let seen: string | null = null
  for (const session of sessions) {
    const label = getSessionProfileLabel(session)
    if (label === null) continue
    if (seen === null) seen = label
    else if (seen !== label) return true
  }
  return false
}
