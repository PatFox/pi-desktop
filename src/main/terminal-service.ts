import { existsSync } from 'fs'
import os from 'os'
import pty, { type IPty } from 'node-pty'
import type { TerminalStartOptions, TerminalStartResult } from '../shared/ipc-contracts'
import { loadPiDotenv } from './pi-dotenv'
import { childProcessEnv } from './windows-exe-search'
import { ompProfileArgument } from '../shared/omp-profile'

/** OMP's environment variable selecting the profile. */
const OMP_PROFILE_ENV = 'OMP_PROFILE'

// Classic VT100 grid, used until the renderer reports the fitted size.
export const DEFAULT_TERMINAL_COLS = 80
export const DEFAULT_TERMINAL_ROWS = 24
/** The terminal the PTY emulates, as node-pty names it and $TERM tells the shell. */
export const TERMINAL_TYPE = 'xterm-256color'

type TerminalDataHandler = (data: string) => void
type TerminalExitHandler = (event: { exitCode: number; signal?: number }) => void

/**
 * The OMP profile a terminal's shell runs `omp` under: pinned to one profile
 * (undefined is the default profile), or null to leave OMP_PROFILE as the app
 * inherited it.
 */
export type TerminalOmpProfile = { profile: string | undefined } | null

/** A terminal start as main issues it: the renderer's options plus the profile. */
export interface TerminalLaunchOptions extends TerminalStartOptions {
  ompProfile?: TerminalOmpProfile
}

/**
 * The shell's environment: ~/.pi/.env under `inherited`. The shell is the
 * user's own tool, so the app's current-folder search switch stays out of it
 * (see childProcessEnv).
 *
 * A pinned OMP profile sets OMP_PROFILE, which OMP reads ahead of its legacy
 * PI_PROFILE; the default profile is named `default` rather than unset, so a
 * PI_PROFILE in the environment cannot take over either.
 */
export function buildTerminalEnv(
  inherited: NodeJS.ProcessEnv = process.env,
  ompProfile: TerminalOmpProfile = null
): Record<string, string> {
  const env: NodeJS.ProcessEnv = { ...loadPiDotenv(), ...inherited, TERM: TERMINAL_TYPE }
  if (ompProfile) {
    // Windows reads variable names case-insensitively; drop every spelling.
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === OMP_PROFILE_ENV) delete env[key]
    }
    env[OMP_PROFILE_ENV] = ompProfileArgument(ompProfile.profile)
  }
  return childProcessEnv(false, env) as Record<string, string>
}

export class TerminalService {
  private terminal: IPty | null = null
  private disposables: { dispose(): void }[] = []
  private cwd = os.homedir()

  start(
    options: TerminalLaunchOptions,
    onData: TerminalDataHandler,
    onExit: TerminalExitHandler
  ): TerminalStartResult {
    this.stop()

    const shell = getShell()
    const cwd = getCwd(options.cwd)

    this.cwd = cwd
    // node-pty's `encoding` option calls setEncoding() under the hood,
    // which Windows (conpty/winpty) does not support and logs a warning
    // for. Only pass it on POSIX platforms.
    const terminal = pty.spawn(shell, [], {
      name: TERMINAL_TYPE,
      cols: options.cols ?? DEFAULT_TERMINAL_COLS,
      rows: options.rows ?? DEFAULT_TERMINAL_ROWS,
      cwd,
      env: buildTerminalEnv(process.env, options.ompProfile ?? null),
      ...(process.platform === 'win32' ? {} : { encoding: 'utf8' }),
    })
    this.terminal = terminal

    this.disposables.push(terminal.onData(onData))
    this.disposables.push(
      terminal.onExit(({ exitCode, signal }) => {
        // Guard against a stale exit from a killed pty clobbering a terminal
        // that has since been recreated (e.g. after a view round-trip).
        if (this.terminal === terminal) this.terminal = null
        onExit({ exitCode, signal })
      })
    )

    return {
      pid: terminal.pid,
      shell,
      cwd,
    }
  }

  write(data: string): void {
    this.terminal?.write(data)
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      this.terminal?.resize(cols, rows)
    }
  }

  stop(): void {
    // Detach handlers before killing so the resulting exit event neither
    // broadcasts a spurious "process exited" into a freshly-created terminal
    // nor nulls it out. See the identity guard in start().
    for (const d of this.disposables) d.dispose()
    this.disposables = []
    const terminal = this.terminal
    this.terminal = null
    terminal?.kill()
  }

  getCwd(): string {
    return this.cwd
  }
}

function getShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'powershell.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

function getCwd(cwd?: string): string {
  if (cwd && existsSync(cwd)) return cwd
  return os.homedir()
}
