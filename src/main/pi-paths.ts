import { join } from 'path'
import { isPathWithin } from '../../resources/path-within'
import type { AgentEngineKind } from '../shared/ipc-contracts'
import { listOmpProfiles, ompSessionsDir } from './omp-paths'

/**
 * Absolute path to Pi's on-disk session store (`~/.pi/agent/sessions`).
 * Centralized so session listing, lineage, and activity aggregation agree.
 */
export function getSessionsRoot(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR ||
    join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.pi', 'agent')
  return join(agentDir, 'sessions')
}

/**
 * Absolute path to OMP's default-profile session store (`~/.omp/agent/sessions`).
 *
 * Each engine keeps its own sessions: OMP writes here, Pi writes under
 * `~/.pi`, and neither is pointed at the other's tree. Both stores use the
 * same per-project directory naming and the same JSONL record shape, so the
 * index can read them side by side. A named OMP profile has its own store
 * (`~/.omp/profiles/<name>/agent/sessions`); see getSessionStores.
 */
export function getOmpSessionsRoot(): string {
  return ompSessionsDir(undefined)
}

/**
 * Who wrote a session: the engine, and for OMP the named profile (undefined is
 * the default profile). Resuming or forking a session must start this exact
 * owner, or it reopens under another account's logins.
 */
export interface SessionOwner {
  engine: AgentEngineKind
  ompProfile?: string
}

/** One session store the index reads, with the owner of every file in it. */
export interface SessionStore extends SessionOwner {
  root: string
}

/**
 * Every store the session index reads: Pi's, OMP's default profile, then each
 * named OMP profile on disk. Pi's comes first so its rows win a tie, and a
 * root listed twice (an env var pointing two stores at one directory) is kept
 * once, under the first owner.
 */
export function getSessionStores(): SessionStore[] {
  const stores: SessionStore[] = [
    { engine: 'pi', root: getSessionsRoot() },
    { engine: 'omp', root: getOmpSessionsRoot() },
    ...listOmpProfiles().map((ompProfile): SessionStore => ({
      engine: 'omp',
      ompProfile,
      root: ompSessionsDir(ompProfile),
    })),
  ]
  const seen = new Set<string>()
  return stores.filter((store) => {
    if (seen.has(store.root)) return false
    seen.add(store.root)
    return true
  })
}

/** The roots of every store the session index reads, in getSessionStores order. */
export function getSessionRoots(): string[] {
  return getSessionStores().map((store) => store.root)
}

/**
 * The owner of a session file: the store it lives in. When stores nest (an
 * agent-dir override placed inside another store) the innermost one owns the
 * file; equal roots were already collapsed onto the first owner. Null means
 * the path is in no store at all, which is also what makes it unauthorized.
 */
export function sessionOwnerForPath(candidate: string): SessionOwner | null {
  let owner: SessionStore | null = null
  for (const store of getSessionStores()) {
    if (!isPathWithin(store.root, candidate)) continue
    if (!owner || store.root.length > owner.root.length) owner = store
  }
  if (!owner) return null
  return owner.ompProfile ? { engine: owner.engine, ompProfile: owner.ompProfile } : { engine: owner.engine }
}

/** The engine that owns a session file; see sessionOwnerForPath. */
export function engineForSessionPath(candidate: string): AgentEngineKind | null {
  return sessionOwnerForPath(candidate)?.engine ?? null
}

/**
 * The owner a start must use, taken from the session file that start is bound
 * to. A fork source outranks a session path because the fork reads the source
 * before it writes anything. Null when the start creates a new session and so
 * has no owner yet, leaving the caller free to use the configured engine and
 * the workspace's profile.
 *
 * Shared by the runtime launcher and the permission-mode options so both agree
 * on which engine a start belongs to — the tool names differ per engine, so a
 * disagreement sends OMP Pi's tool list.
 */
export function sessionOwnerForBoundSession(
  bound: { sessionPath?: string; forkSessionPath?: string }
): SessionOwner | null {
  const boundSessionPath = bound.forkSessionPath ?? bound.sessionPath
  return boundSessionPath ? sessionOwnerForPath(boundSessionPath) : null
}

/** The engine a start must use; see sessionOwnerForBoundSession. */
export function engineForBoundSession(
  bound: { sessionPath?: string; forkSessionPath?: string }
): AgentEngineKind | null {
  return sessionOwnerForBoundSession(bound)?.engine ?? null
}

/**
 * Authorization gate for a session path the renderer supplied. A path is
 * acceptable when it sits inside any store the index itself reads; anything
 * else is refused, which is what keeps resume/fork/delete inside the stores.
 * Named-profile stores come only from directories on disk whose names OMP
 * accepts (listOmpProfiles), never from a name the renderer sent.
 */
export function isWithinSessionRoots(candidate: string): boolean {
  return sessionOwnerForPath(candidate) !== null
}
