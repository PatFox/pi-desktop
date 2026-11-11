import { ipcMain } from 'electron'
import type { AgentEngineKind, ModelsFileInfo, ModelsReadFailure, ModelsReadResult } from '../../shared/ipc-contracts'
import { IPC_CHANNELS, isAgentEngineKind } from '../../shared/ipc-contracts'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import {
  describeModelsReadFailure,
  isModelsConfig,
  parseModelsFile,
  resolveModelsFile,
  serializeModelsFile,
  type ModelsFileLocation,
} from '../models-file'
import { activeEngineKind, activeOmpProfile } from './active-engine'
import { normalizeOmpProfile } from '../../shared/omp-profile'
import type { IpcContext } from './context'

function modelsFileLocation(engine: AgentEngineKind, ompProfile: string | undefined): ModelsFileLocation {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return resolveModelsFile(engine, homeDir, ompProfile)
}

function fileInfo(engine: AgentEngineKind, ompProfile: string | undefined, location: ModelsFileLocation): ModelsFileInfo {
  // Pi has no profiles, so its file never carries one.
  const profile = engine === 'omp' ? ompProfile : undefined
  return { engine, ...(profile ? { ompProfile: profile } : {}), file: location.file, name: location.name }
}

function failed(
  location: ModelsFileLocation,
  info: ModelsFileInfo,
  failure: ModelsReadFailure,
  raw: string,
): ModelsReadResult {
  return { error: describeModelsReadFailure(location.name, failure), failure, raw, location: info }
}

export async function readModelsConfigFile(engine: AgentEngineKind, ompProfile?: string): Promise<ModelsReadResult> {
  const location = modelsFileLocation(engine, ompProfile)
  const info = fileInfo(engine, ompProfile, location)
  if (!existsSync(location.file)) return { config: { providers: {} }, location: info }
  let raw: string
  try {
    raw = await readFile(location.file, 'utf-8')
  } catch (err) {
    return failed(location, info, { kind: 'unreadable', detail: err instanceof Error ? err.message : String(err) }, '')
  }
  try {
    const parsed = parseModelsFile(raw, location.format)
    if (!isModelsConfig(parsed)) {
      return failed(location, info, { kind: 'missing-providers' }, raw)
    }
    return { config: parsed, location: info }
  } catch (err) {
    return failed(location, info, {
      kind: 'invalid-syntax',
      format: location.format,
      detail: err instanceof Error ? err.message : String(err),
    }, raw)
  }
}

export function registerModelsConfigHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  ipcMain.handle(IPC_CHANNELS.MODELS_READ, async (): Promise<ModelsReadResult> => {
    return readModelsConfigFile(activeEngineKind(workspaceManager), activeOmpProfile(workspaceManager))
  })

  ipcMain.handle(IPC_CHANNELS.MODELS_WRITE, async (
    _event,
    config: unknown,
    engine: unknown,
    ompProfile: unknown
  ): Promise<{ success: boolean; error?: string }> => {
    if (!isModelsConfig(config)) {
      return { success: false, error: 'Invalid models config' }
    }
    // The editor names the engine whose file it read. The engine in use can
    // change while the editor is open, and resolving it again here would put
    // one engine's providers into the other's file.
    if (!isAgentEngineKind(engine)) {
      return { success: false, error: 'Invalid models engine' }
    }
    // Likewise the OMP profile: each profile has its own file, and the active
    // one can change while the editor is open.
    const profile = normalizeOmpProfile(ompProfile)
    if (profile === null) {
      return { success: false, error: 'Invalid models profile' }
    }
    const location = modelsFileLocation(engine, profile)
    try {
      if (!existsSync(location.dir)) await mkdir(location.dir, { recursive: true })
      await writeFile(location.file, serializeModelsFile(config, location.format), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
