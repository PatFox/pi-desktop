import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc-contracts'
import { isValidPackageSpec } from '../../shared/package-spec'
import { fetchPackageCatalog } from '../package-catalog'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { assertTrustedSender, isString } from './validation'
import { runPiCli } from './run-pi-cli'
import { activeEngineKind, activeOmpProfile } from './active-engine'
import { ompPluginsDir } from '../omp-paths'
import { parseOmpPluginList, type OmpNpmPlugin } from '../omp-plugin-list'
import {
  explainOmpFailure,
  findPackageUpdates,
  ompNpmTargets,
  OmpPluginListError,
  ompUpdateInstallSpec,
  piRegistryQuery,
  type OmpNpmTarget,
  type OmpRegistryQuery,
  type UpdateCandidate,
} from '../package-updates'
import type { AgentEngineKind, InstalledPackage, PackageUpdate } from '../../shared/ipc-contracts'
import type { IpcContext } from './context'
import { t } from '../../shared/i18n'

export function registerPackageHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  // ─── Package Management ─────────────────────────────────────────────────

  // Package actions target the engine the user is looking at, and run that
  // engine's own CLI — a session from the other store can be active while a
  // different engine is the configured default. Under OMP they also target the
  // active profile, whose plugin store is separate from every other profile's.
  const activeTarget = (): PackageTarget => ({
    cwd: workspaceManager.getActiveWorkspace()?.path ?? process.cwd(),
    engine: activeEngineKind(workspaceManager),
    ompProfile: activeOmpProfile(workspaceManager),
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_LIST_INSTALLED, async () => {
    return listInstalledPackages(activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_INSTALL, async (event, packageSpec: unknown) => {
    assertTrustedSender(event)
    if (!isString(packageSpec)) throw new Error('packageSpec must be a string')
    if (!isValidPackageSpec(packageSpec)) throw new Error(t('errors.packages.invalidSpec'))
    return installPackage(packageSpec, activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_REMOVE, async (event, packageSpec: unknown) => {
    assertTrustedSender(event)
    if (!isString(packageSpec)) throw new Error('packageSpec must be a string')
    if (!isValidPackageSpec(packageSpec)) throw new Error(t('errors.packages.invalidSpec'))
    return removePackage(packageSpec, activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_UPDATE, async (event, packageSpec: unknown) => {
    assertTrustedSender(event)
    if (!isString(packageSpec)) throw new Error('packageSpec must be a string')
    if (!isValidPackageSpec(packageSpec)) throw new Error(t('errors.packages.invalidSpec'))
    return updatePackage(packageSpec, activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_UPDATE_ALL, async (event) => {
    assertTrustedSender(event)
    return updateAllPackages(activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_CHECK_UPDATES, async () => {
    return checkPackageUpdates(activeTarget())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_CATALOG_FETCH, async (_event, query?: unknown) => {
    return fetchPackageCatalog(isString(query) ? query : undefined)
  })
}

// ─── Package Management ──────────────────────────────────────────────────────

const LIST_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 120_000
const REMOVE_TIMEOUT_MS = 30_000
const UPDATE_TIMEOUT_MS = 120_000
// Updating every package runs one install per outdated package.
const UPDATE_ALL_TIMEOUT_MS = 300_000

// Bare `pi update` updates Pi itself; `--extensions` limits it to packages.
const PI_UPDATE_ALL_ARGS = ['update', '--extensions']
const OMP_PLUGIN_LIST_ARGS = ['plugin', 'list', '--json']
// Without a plugin id, OMP upgrades every outdated marketplace plugin.
const OMP_MARKETPLACE_UPGRADE_ARGS = ['plugin', 'upgrade']

type CliResult = { success: boolean; output: string }

/** Where a package action runs: the workspace, the engine, and OMP's profile. */
interface PackageTarget {
  cwd: string
  engine: AgentEngineKind
  /** OMP profile whose plugin store the action reads or changes; undefined is the default. */
  ompProfile?: string
}

interface PiPackageScope {
  scope: 'global' | 'project'
  settingsPath: string
  npmRoot: string
}

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? ''
}

/** Pi's package scopes: each has a settings `packages` array and a shared npm project. */
function piPackageScopes(cwd: string): PiPackageScope[] {
  const agentDir = join(homeDir(), '.pi', 'agent')
  const projectDir = join(cwd, '.pi')
  return [
    { scope: 'global', settingsPath: join(agentDir, 'settings.json'), npmRoot: join(agentDir, 'npm') },
    { scope: 'project', settingsPath: join(projectDir, 'settings.json'), npmRoot: join(projectDir, 'npm') },
  ]
}

async function listInstalledPackages(target: PackageTarget): Promise<InstalledPackage[]> {
  try {
    if (target.engine === 'omp') return listOmpPlugins(target)
    const packages: InstalledPackage[] = []
    for (const { scope, settingsPath } of piPackageScopes(target.cwd)) {
      const scopePackages = await readPackagesFromSettings(settingsPath)
      packages.push(...scopePackages.map((p) => ({ ...p, scope })))
    }
    return packages
  } catch {
    return []
  }
}

/**
 * OMP does not track packages in a settings.json `packages` array — its plugin
 * store lives in `~/.omp/plugins/` (per profile) — so the installed list comes
 * from the CLI.
 */
async function listOmpPlugins(target: PackageTarget): Promise<InstalledPackage[]> {
  const result = await runPiCli(OMP_PLUGIN_LIST_ARGS, target.cwd, LIST_TIMEOUT_MS, 'omp', target.ompProfile)
  if (!result.success) return []
  return parseOmpPluginList(result.output, ompPluginsDir(target.ompProfile))
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function readPackageVersion(packageJsonPath: string): Promise<string | null> {
  const version = (await readJsonObject(packageJsonPath))?.version
  return typeof version === 'string' ? version : null
}

async function piUpdateCandidates(cwd: string): Promise<UpdateCandidate[]> {
  const candidates: UpdateCandidate[] = []
  for (const { settingsPath, npmRoot } of piPackageScopes(cwd)) {
    for (const pkg of await readPackagesFromSettings(settingsPath)) {
      const query = piRegistryQuery(pkg.source)
      if (!query) continue
      const installedVersion = await readPackageVersion(join(npmRoot, 'node_modules', query.name, 'package.json'))
      if (installedVersion) candidates.push({ source: pkg.source, query, installedVersion })
    }
  }
  return candidates
}

/**
 * OMP's npm plugins with their registry lookups. The lookup comes from the
 * plugin store's package.json, which records how each plugin was installed.
 */
async function readOmpNpmTargets(target: PackageTarget): Promise<OmpNpmTarget[]> {
  const result = await runPiCli(OMP_PLUGIN_LIST_ARGS, target.cwd, LIST_TIMEOUT_MS, 'omp', target.ompProfile)
  const manifest = await readJsonObject(join(ompPluginsDir(target.ompProfile), 'package.json'))
  return ompNpmTargets(result, (manifest?.dependencies ?? {}) as Record<string, unknown>)
}

/** Run an OMP mutation that needs the npm plugin list; a failed list is the result. */
async function withOmpNpmTargets(
  target: PackageTarget,
  mutate: (targets: OmpNpmTarget[]) => Promise<CliResult>
): Promise<CliResult> {
  let targets: OmpNpmTarget[]
  try {
    targets = await readOmpNpmTargets(target)
  } catch (error) {
    if (!(error instanceof OmpPluginListError)) throw error
    return { success: false, output: t('errors.packages.listFailed', { detail: error.detail }) }
  }
  return mutate(targets)
}

function ompUpdateCandidates(targets: OmpNpmTarget[]): UpdateCandidate[] {
  return targets.flatMap(({ plugin, query }) =>
    query && plugin.version ? [{ source: plugin.name, query, installedVersion: plugin.version }] : []
  )
}

async function checkPackageUpdates(target: PackageTarget): Promise<PackageUpdate[]> {
  const candidates = target.engine === 'omp'
    ? ompUpdateCandidates(await readOmpNpmTargets(target))
    : await piUpdateCandidates(target.cwd)
  return findPackageUpdates(candidates)
}

function combineResults(results: CliResult[]): CliResult {
  return {
    success: results.every((result) => result.success),
    output: results.map((result) => result.output.trim()).filter(Boolean).join('\n\n'),
  }
}

function withOmpFailureExplained(result: CliResult, engine: AgentEngineKind): CliResult {
  return engine === 'omp' && !result.success ? { ...result, output: explainOmpFailure(result.output) } : result
}

/** Run an OMP command that changes the plugin store. */
async function runOmpMutation(args: string[], target: PackageTarget, timeout: number): Promise<CliResult> {
  return withOmpFailureExplained(await runPiCli(args, target.cwd, timeout, 'omp', target.ompProfile), 'omp')
}

/**
 * OMP has no update command for npm plugins, so an update reinstalls from the
 * registry. The install spec carries the feature selection; `omp install`
 * also re-enables the plugin, so a disabled plugin is disabled again.
 */
async function updateOmpNpmPlugin(
  plugin: OmpNpmPlugin,
  query: OmpRegistryQuery,
  target: PackageTarget
): Promise<CliResult> {
  const install = await runOmpMutation(['install', ompUpdateInstallSpec(query, plugin)], target, UPDATE_TIMEOUT_MS)
  if (!install.success || plugin.enabled) return install
  const disable = await runOmpMutation(['plugin', 'disable', plugin.name], target, UPDATE_TIMEOUT_MS)
  return combineResults([install, disable])
}

async function updateOmpPlugin(spec: string, target: PackageTarget): Promise<CliResult> {
  return withOmpNpmTargets(target, async (targets) => {
    const npmTarget = targets.find(({ plugin }) => plugin.name === spec)
    // Not an npm plugin: marketplace ids (`name@marketplace`) have a native upgrade.
    if (!npmTarget) return runOmpMutation(['plugin', 'upgrade', spec], target, UPDATE_TIMEOUT_MS)
    if (!npmTarget.query) {
      return { success: false, output: t('errors.packages.pinnedOrNotFromNpm', { spec }) }
    }
    return updateOmpNpmPlugin(npmTarget.plugin, npmTarget.query, target)
  })
}

async function updateAllOmpPlugins(target: PackageTarget): Promise<CliResult> {
  return withOmpNpmTargets(target, async (targets) => {
    const outdated = new Set((await findPackageUpdates(ompUpdateCandidates(targets))).map((update) => update.source))
    const results = [await runOmpMutation(OMP_MARKETPLACE_UPGRADE_ARGS, target, UPDATE_ALL_TIMEOUT_MS)]
    // Sequential: every npm plugin shares one bun project and lockfile.
    for (const { plugin, query } of targets) {
      if (query && outdated.has(plugin.name)) results.push(await updateOmpNpmPlugin(plugin, query, target))
    }
    return combineResults(results)
  })
}

async function readPackagesFromSettings(settingsPath: string): Promise<InstalledPackage[]> {
  const packageEntries = (await readJsonObject(settingsPath))?.packages
  if (!Array.isArray(packageEntries)) return []
  return packageEntries.map((entry: unknown): InstalledPackage => {
    if (typeof entry === 'string') {
      return {
        name: extractPackageName(entry),
        source: entry,
        type: 'package',
        version: extractVersion(entry),
        path: settingsPath,
      }
    }
    if (typeof entry === 'object' && entry !== null) {
      const e = entry as Record<string, unknown>
      return {
        name: extractPackageName(String(e.source ?? '')),
        source: String(e.source ?? ''),
        type: 'package',
        version: extractVersion(String(e.source ?? '')),
        path: settingsPath,
      }
    }
    return { name: 'unknown', source: String(entry), type: 'package', version: null, path: settingsPath }
  })
}

function extractPackageName(source: string): string {
  // npm:@scope/name@1.0.0 -> @scope/name
  // npm:name@1.0.0 -> name
  // git:github.com/user/repo -> user/repo
  const npmMatch = source.match(/^npm:(@?[^@]+)/)
  if (npmMatch) return npmMatch[1]

  const gitMatch = source.match(/github\.com\/([^/]+\/[^/@]+)/)
  if (gitMatch) return gitMatch[1]

  return source.split('/').pop() ?? source
}

function extractVersion(source: string): string | null {
  const match = source.match(/@([^/]+)$/)
  return match ? match[1] : null
}

/** Run a package CLI command for `target`'s engine (and OMP profile). */
function runTargetCli(args: string[], target: PackageTarget, timeout: number): Promise<CliResult> {
  return runPiCli(args, target.cwd, timeout, target.engine, target.ompProfile)
}

async function installPackage(spec: string, target: PackageTarget): Promise<CliResult> {
  return withOmpFailureExplained(await runTargetCli(['install', spec], target, INSTALL_TIMEOUT_MS), target.engine)
}

async function removePackage(spec: string, target: PackageTarget): Promise<CliResult> {
  return runTargetCli(['remove', spec], target, REMOVE_TIMEOUT_MS)
}

async function updatePackage(spec: string, target: PackageTarget): Promise<CliResult> {
  if (target.engine === 'omp') return updateOmpPlugin(spec, target)
  return runTargetCli(['update', spec], target, UPDATE_TIMEOUT_MS)
}

async function updateAllPackages(target: PackageTarget): Promise<CliResult> {
  if (target.engine === 'omp') return updateAllOmpPlugins(target)
  return runTargetCli(PI_UPDATE_ALL_ARGS, target, UPDATE_ALL_TIMEOUT_MS)
}
