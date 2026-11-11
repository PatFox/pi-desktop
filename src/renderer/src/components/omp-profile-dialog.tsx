import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, UserRound, X } from 'lucide-react'
import { agentEngineLabel } from '../../../shared/agent-engine-label'
import { isValidOmpProfileName } from '../../../shared/omp-profile'
import { formatIpcError } from '../utils/ipc-error'
import { ompProfileChoice, ompProfileFromChoice, ompProfileOptions, type OmpProfileChoice } from '../utils/omp-profile-choice'

const FIELD = 'mt-1 w-full rounded border border-border-strong bg-app px-2 py-1.5 text-sm text-primary outline-none focus:border-focus'
const OMP_LOGIN_COMMAND = 'omp login'

/**
 * Pick the OMP profile a workspace's new sessions run under: the default
 * profile, one that exists under ~/.omp/profiles, or a new name (OMP creates
 * its folder on first use). Each profile has its own logins, so the dialog
 * points at the terminal for signing in to a new one.
 */
export function OmpProfileDialog({ workspaceName, currentProfile, onClose, onSave }: {
  workspaceName: string
  /** The workspace's profile now; undefined is the default profile. */
  currentProfile: string | undefined
  onClose: () => void
  onSave: (profile: string | undefined) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const engine = agentEngineLabel('omp')
  const [profiles, setProfiles] = useState<string[] | null>(null)
  const [choice, setChoice] = useState<OmpProfileChoice>(ompProfileChoice(currentProfile))
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.piDesktop.pi.listOmpProfiles()
      .then((names) => {
        if (!cancelled) setProfiles(names)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setProfiles([])
        setError(t('ompProfile.dialog.loadFailed', { engine, detail: formatIpcError(err) }))
      })
    return () => {
      cancelled = true
    }
    // Load once per opening; the translator is only used for the failure text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = (): void => {
    if (!busy) onClose()
  }

  const save = async (): Promise<void> => {
    if (busy) return
    const profile = ompProfileFromChoice(choice, newName)
    if (profile === null) {
      setError(t('ompProfile.dialog.invalidName'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(profile)
      onClose()
    } catch (err) {
      setError(formatIpcError(err))
    } finally {
      setBusy(false)
    }
  }

  const options = ompProfileOptions(profiles ?? [], currentProfile)
  const newNameInvalid = choice.kind === 'new' && newName.trim() !== '' && !isValidOmpProfileName(newName.trim())

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
      role="presentation"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border-strong bg-surface shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-primary">{t('ompProfile.dialog.title', { engine })}</h2>
            <p className="mt-0.5 text-xs text-dim">{t('ompProfile.dialog.intro', { engine, workspace: workspaceName })}</p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded p-1 text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-50"
            aria-label={t('common.close')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <label className="block text-xs text-muted">
            {t('ompProfile.dialog.profileLabel')}
            <select
              value={choice.kind === 'named' ? `named:${choice.name}` : choice.kind}
              onChange={(event) => {
                const value = event.target.value
                setError(null)
                if (value === 'default' || value === 'new') setChoice({ kind: value })
                else setChoice({ kind: 'named', name: value.slice('named:'.length) })
              }}
              disabled={busy || profiles === null}
              className={FIELD}
              autoFocus
            >
              <option value="default">{t('ompProfile.dialog.defaultOption')}</option>
              {options.map((name) => (
                <option key={name} value={`named:${name}`}>{name}</option>
              ))}
              <option value="new">{t('ompProfile.dialog.newOption')}</option>
            </select>
          </label>

          {choice.kind === 'new' && (
            <label className="block text-xs text-muted">
              {t('ompProfile.dialog.newNameLabel')}
              <input
                type="text"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value)
                  setError(null)
                }}
                placeholder={t('ompProfile.dialog.newNamePlaceholder')}
                aria-invalid={newNameInvalid}
                spellCheck={false}
                disabled={busy}
                className={FIELD}
                autoFocus
              />
              {newNameInvalid && <span className="mt-1 block text-[11px] text-warning">{t('ompProfile.dialog.invalidName')}</span>}
            </label>
          )}

          <p className="flex items-start gap-1.5 text-[11px] text-dim">
            <UserRound size={12} className="mt-0.5 shrink-0" />
            <span>{t('ompProfile.dialog.loginHint', { command: OMP_LOGIN_COMMAND })}</span>
          </p>

          {error && (
            <p role="alert" className="whitespace-pre-wrap break-words rounded border border-error/20 bg-error-bg px-3 py-2 text-xs text-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-primary disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || profiles === null}
            className="flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
