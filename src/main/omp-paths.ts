import { readdirSync } from 'fs'
import { join } from 'path'
import { isValidOmpProfileName } from '../shared/omp-profile'

/**
 * OMP's on-disk layout per profile. The default profile is the plain `~/.omp`
 * tree; a named profile relocates the whole tree to `~/.omp/profiles/<name>`
 * (logins, sessions, models, MCP servers, skills and plugins alike), which is
 * what keeps two accounts apart. Every OMP path the app reads goes through
 * here so the panels follow the same profile the agent runs under.
 *
 * `OMP_CODING_AGENT_DIR` keeps relocating the default profile's agent
 * directory, as it did before profiles. OMP likewise ignores its own agent-dir
 * override for named profiles, so a named profile always derives from home.
 */

const OMP_HOME_DIR_NAME = '.omp'
const OMP_PROFILES_DIR_NAME = 'profiles'
const OMP_AGENT_DIR_NAME = 'agent'
const OMP_SESSIONS_DIR_NAME = 'sessions'
const OMP_PLUGINS_DIR_NAME = 'plugins'

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? ''
}

/** `~/.omp`: the default profile's root and the parent of every named one. */
export function ompHomeDir(): string {
  return join(homeDir(), OMP_HOME_DIR_NAME)
}

/**
 * The root of one profile's tree under an explicit home directory, for callers
 * that already take `homeDir` as a parameter (and their tests).
 */
export function ompProfileRootIn(home: string, profile: string | undefined): string {
  const ompHome = join(home, OMP_HOME_DIR_NAME)
  return profile ? join(ompHome, OMP_PROFILES_DIR_NAME, profile) : ompHome
}

/** The root of one profile's tree: `~/.omp` or `~/.omp/profiles/<name>`. */
export function ompProfileRoot(profile: string | undefined): string {
  return ompProfileRootIn(homeDir(), profile)
}

/** A profile's agent directory under an explicit home; no env override applies. */
export function ompAgentDirIn(home: string, profile: string | undefined): string {
  return join(ompProfileRootIn(home, profile), OMP_AGENT_DIR_NAME)
}

/** A profile's agent directory (`models.yml`, `mcp.json`, `skills/`, `sessions/`). */
export function ompAgentDir(profile: string | undefined): string {
  if (!profile && process.env.OMP_CODING_AGENT_DIR) return process.env.OMP_CODING_AGENT_DIR
  return join(ompProfileRoot(profile), OMP_AGENT_DIR_NAME)
}

/** A profile's session store. */
export function ompSessionsDir(profile: string | undefined): string {
  return join(ompAgentDir(profile), OMP_SESSIONS_DIR_NAME)
}

/** A profile's plugin store. */
export function ompPluginsDir(profile: string | undefined): string {
  return join(ompProfileRoot(profile), OMP_PLUGINS_DIR_NAME)
}

/**
 * The named profiles that exist on disk, sorted. Only real directories whose
 * names OMP itself would accept are returned, so a stray file or a link under
 * `~/.omp/profiles` can never widen the session stores the app trusts.
 */
export function listOmpProfiles(): string[] {
  let entries
  try {
    entries = readdirSync(join(ompHomeDir(), OMP_PROFILES_DIR_NAME), { withFileTypes: true })
  } catch {
    // No profiles directory yet: only the default profile exists.
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && isValidOmpProfileName(entry.name))
    .map((entry) => entry.name)
    .sort()
}
