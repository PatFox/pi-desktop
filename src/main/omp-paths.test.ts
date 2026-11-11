import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  listOmpProfiles,
  ompAgentDir,
  ompHomeDir,
  ompPluginsDir,
  ompProfileRoot,
  ompSessionsDir,
} from './omp-paths'

async function withHome(run: (home: string) => Promise<void> | void): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'omp-paths-'))
  const saved = { HOME: process.env.HOME, OMP_CODING_AGENT_DIR: process.env.OMP_CODING_AGENT_DIR }
  process.env.HOME = home
  delete process.env.OMP_CODING_AGENT_DIR
  try {
    await run(home)
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(home, { recursive: true, force: true })
  }
}

test('the default profile is the plain ~/.omp tree', async () => {
  await withHome((home) => {
    assert.equal(ompHomeDir(), join(home, '.omp'))
    assert.equal(ompProfileRoot(undefined), join(home, '.omp'))
    assert.equal(ompAgentDir(undefined), join(home, '.omp', 'agent'))
    assert.equal(ompSessionsDir(undefined), join(home, '.omp', 'agent', 'sessions'))
    assert.equal(ompPluginsDir(undefined), join(home, '.omp', 'plugins'))
  })
})

test('a named profile relocates the whole tree under ~/.omp/profiles', async () => {
  await withHome((home) => {
    const root = join(home, '.omp', 'profiles', 'work')
    assert.equal(ompProfileRoot('work'), root)
    assert.equal(ompAgentDir('work'), join(root, 'agent'))
    assert.equal(ompSessionsDir('work'), join(root, 'agent', 'sessions'))
    assert.equal(ompPluginsDir('work'), join(root, 'plugins'))
  })
})

test('OMP_CODING_AGENT_DIR moves only the default profile', async () => {
  await withHome((home) => {
    process.env.OMP_CODING_AGENT_DIR = join(home, 'custom-agent')
    assert.equal(ompAgentDir(undefined), join(home, 'custom-agent'))
    assert.equal(ompSessionsDir(undefined), join(home, 'custom-agent', 'sessions'))
    // OMP ignores its agent-dir override for named profiles, and so does the app.
    assert.equal(ompAgentDir('work'), join(home, '.omp', 'profiles', 'work', 'agent'))
  })
})

test('listing profiles with no profiles directory finds none', async () => {
  await withHome(() => {
    assert.deepEqual(listOmpProfiles(), [])
  })
})

test('listing profiles returns valid directory names only, sorted', async () => {
  await withHome(async (home) => {
    const profiles = join(home, '.omp', 'profiles')
    // Invalid names chosen so every filesystem can create them (Windows refuses
    // `con` and strips a trailing dot, so those are covered by omp-profile tests).
    for (const name of ['work', 'client-b', 'Bad-Case', '-flag', 'has space']) {
      await mkdir(join(profiles, name), { recursive: true })
    }
    await writeFile(join(profiles, 'stray-file'), '')
    assert.deepEqual(listOmpProfiles(), ['client-b', 'work'])
  })
})
