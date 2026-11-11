import { DEFAULT_OMP_PROFILE_NAME, isValidOmpProfileName } from '../../../shared/omp-profile'

/** What the OMP profile picker has selected. */
export type OmpProfileChoice =
  | { kind: 'default' }
  | { kind: 'named'; name: string }
  | { kind: 'new' }

/** The picker's starting selection for a workspace's current profile. */
export function ompProfileChoice(current: string | undefined): OmpProfileChoice {
  return current ? { kind: 'named', name: current } : { kind: 'default' }
}

/**
 * The named profiles the picker lists: those on disk, plus the workspace's
 * current one even when its folder does not exist yet (it was typed as a new
 * name and OMP has not run under it), sorted without duplicates.
 */
export function ompProfileOptions(onDisk: readonly string[], current: string | undefined): string[] {
  return [...new Set(current ? [...onDisk, current] : onDisk)].sort()
}

/**
 * The profile to save for a selection: undefined for the default profile, the
 * name otherwise, or null when a typed new name is not one OMP accepts.
 * Typing `default` selects the default profile rather than a profile of that name.
 */
export function ompProfileFromChoice(choice: OmpProfileChoice, newName: string): string | undefined | null {
  if (choice.kind === 'default') return undefined
  if (choice.kind === 'named') return choice.name
  const name = newName.trim()
  if (name === DEFAULT_OMP_PROFILE_NAME) return undefined
  return isValidOmpProfileName(name) ? name : null
}
