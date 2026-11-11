import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runPiCli } from './run-pi-cli'
import { getPiCli, setPiExecutableOverride } from '../pi-rpc-manager'
import { describePiStartFailure } from '../pi-binary-resolution'
import { t } from '../../shared/i18n'

const CLI_TIMEOUT_MS = 10_000

test('a package command with no engine installed reports it instead of starting a bare name', async () => {
  // A configured OMP path that does not exist resolves to the bare `omp`
  // fallback. Spawned with the workspace as the working directory, Windows
  // would look that name up in the workspace first.
  const dir = mkdtempSync(join(tmpdir(), 'pi-cli-missing-'))
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL }
  try {
    // An empty PATH and no login shell: even a bare spawn could reach no real engine.
    process.env.PATH = dir
    process.env.SHELL = join(dir, 'no-such-shell')
    setPiExecutableOverride(join(dir, 'missing-omp'), 'omp')
    const { failureReason } = getPiCli()
    assert.ok(failureReason, 'the missing engine is a start failure')

    assert.deepEqual(await runPiCli(['--version'], dir, CLI_TIMEOUT_MS), {
      success: false,
      output: describePiStartFailure(failureReason, t),
    })
  } finally {
    setPiExecutableOverride(null, 'auto')
    process.env.PATH = saved.PATH
    if (saved.SHELL === undefined) delete process.env.SHELL
    else process.env.SHELL = saved.SHELL
    rmSync(dir, { recursive: true, force: true })
  }
})

const SKIP_ON_WINDOWS = { skip: process.platform === 'win32' ? 'POSIX shebang fixture' : false }
const ARGV_ECHO_SOURCE = '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n'

async function cliArgv(engine: 'pi' | 'omp', args: string[], ompProfile?: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), 'pi-cli-argv-'))
  const saved = { SHELL: process.env.SHELL }
  try {
    process.env.SHELL = join(dir, 'no-such-shell')
    const script = join(dir, engine)
    writeFileSync(script, ARGV_ECHO_SOURCE)
    chmodSync(script, 0o755)
    setPiExecutableOverride(script, engine)
    const result = await runPiCli(args, dir, CLI_TIMEOUT_MS, undefined, ompProfile)
    assert.equal(result.success, true, result.output)
    return JSON.parse(result.output) as string[]
  } finally {
    setPiExecutableOverride(null, 'auto')
    if (saved.SHELL === undefined) delete process.env.SHELL
    else process.env.SHELL = saved.SHELL
    rmSync(dir, { recursive: true, force: true })
  }
}

test('an OMP command runs under the given profile, ahead of the subcommand', SKIP_ON_WINDOWS, async () => {
  assert.deepEqual(await cliArgv('omp', ['plugin', 'list', '--json'], 'work'), ['--profile', 'work', 'plugin', 'list', '--json'])
  // The remove alias still maps to OMP's own verb, behind the profile.
  assert.deepEqual(await cliArgv('omp', ['remove', 'x'], 'work'), ['--profile', 'work', 'plugin', 'uninstall', 'x'])
  assert.deepEqual(await cliArgv('omp', ['--version']), ['--profile', 'default', '--version'])
})

test('a Pi command gets no profile flag', SKIP_ON_WINDOWS, async () => {
  assert.deepEqual(await cliArgv('pi', ['install', 'x'], 'work'), ['install', 'x'])
})
