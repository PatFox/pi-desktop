/**
 * OMP named profiles (`omp --profile <name>`, or `OMP_PROFILE`) keep separate
 * logins, sessions, settings and plugins under `~/.omp/profiles/<name>`. A
 * workspace can pin one, so every OMP process started for it runs as that
 * account. The default profile is the plain `~/.omp` tree and is represented
 * as `undefined` everywhere in the app.
 *
 * The name rule mirrors OMP's own (`normalizeProfileName` in pi-utils): the
 * same names OMP accepts are accepted here and nothing more, so a profile the
 * app writes always resolves to the directory OMP reads. The name also becomes
 * a path segment and a CLI argument, which this rule keeps safe: it cannot
 * start with `-`, contain a separator, or name `.`/`..`.
 */

import type { AgentEngineKind } from './ipc-contracts'

/** The name OMP reads as "the default profile"; stored as `undefined`. */
export const DEFAULT_OMP_PROFILE_NAME = 'default'

/** Longest profile name OMP accepts. */
export const MAX_OMP_PROFILE_NAME_LENGTH = 64

const OMP_PROFILE_NAME_PATTERN = new RegExp(`^[a-z0-9][a-z0-9._-]{0,${MAX_OMP_PROFILE_NAME_LENGTH - 1}}$`)

// Windows refuses these as file names whatever the extension, so OMP refuses
// them as profile names on every platform.
const WINDOWS_RESERVED_BASENAME_PATTERN = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

/** True when `name` is a named (non-default) profile OMP would accept. */
export function isValidOmpProfileName(name: string): boolean {
  return (
    OMP_PROFILE_NAME_PATTERN.test(name) &&
    !name.endsWith('.') &&
    !WINDOWS_RESERVED_BASENAME_PATTERN.test(name)
  )
}

/**
 * Normalize a profile value from storage, IPC, or user input.
 *
 * - `undefined`: the default profile (missing, empty, or `default`)
 * - a string: a valid named profile, trimmed
 * - `null`: anything else, which callers reject or drop
 */
export function normalizeOmpProfile(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === DEFAULT_OMP_PROFILE_NAME) return undefined
  return isValidOmpProfileName(trimmed) ? trimmed : null
}

/** The `--profile` value for an OMP invocation: the name, or `default`. */
export function ompProfileArgument(profile: string | undefined): string {
  return profile ?? DEFAULT_OMP_PROFILE_NAME
}

/** OMP's flag selecting the profile; read before subcommand routing. */
export const OMP_PROFILE_FLAG = '--profile'

/**
 * The leading argv that pins an invocation to a profile: `--profile <name>`
 * for OMP (including an explicit `default`, which outranks an OMP_PROFILE the
 * app inherited), nothing for Pi, which has no profiles.
 */
export function ompProfileArgs(engine: AgentEngineKind | null | undefined, profile: string | undefined): string[] {
  return engine === 'omp' ? [OMP_PROFILE_FLAG, ompProfileArgument(profile)] : []
}
