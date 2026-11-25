'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { getStoredItem, setStoredItem } from '../services/localStore'
import { subscribeSessionChanged } from '../services/sessionEvents'
import { getUserStorage } from '../services/storageService'
import { getUserData, updateUserData } from '../services/userService'
import type { PrivacyMode, PWIDUser } from '../types'

export type { PrivacyMode }

export interface Preferences {
  easyRead: boolean
  textScale: number
  privacyMode: PrivacyMode
  privacyUpdatedAt: number
}

const DEFAULT_PREFERENCES: Preferences = {
  easyRead: false,
  textScale: 1,
  privacyMode: 'trip-only',
  privacyUpdatedAt: 0
}

const LEGACY_STORAGE_KEY = 'eb-preferences'
const storageKey = (phoneNumber: string) => `eb-preferences:${phoneNumber || 'guest'}`

function normalizePreferences(value: unknown): Preferences {
  const parsed = value && typeof value === 'object' ? (value as Partial<Preferences>) : {}
  const privacyMode: PrivacyMode =
    parsed.privacyMode === 'always' || parsed.privacyMode === 'paused' || parsed.privacyMode === 'trip-only'
      ? parsed.privacyMode
      : DEFAULT_PREFERENCES.privacyMode
  return {
    easyRead: typeof parsed.easyRead === 'boolean' ? parsed.easyRead : DEFAULT_PREFERENCES.easyRead,
    textScale: Math.min(1.3, Math.max(1, Number(parsed.textScale) || 1)),
    privacyMode,
    privacyUpdatedAt: Math.max(0, Number(parsed.privacyUpdatedAt) || 0)
  }
}

function parsePreferences(raw: string | null): Preferences | null {
  if (!raw) return null
  try {
    return normalizePreferences(JSON.parse(raw))
  } catch {
    return null
  }
}

interface PreferencesContextValue {
  preferences: Preferences
  ready: boolean
  updatePreferences: (patch: Partial<Preferences>) => void
  scale: (size: number) => number
  bodyLine: (size: number) => number
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(
  undefined
)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES)
  const [owner, setOwner] = useState('')
  const [userType, setUserType] = useState<string | undefined>()
  const [preview, setPreview] = useState(false)
  const [ready, setReady] = useState(false)
  const lastSyncedMode = useRef<PrivacyMode | null>(null)
  const loadId = useRef(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const id = ++loadId.current
      setReady(false)
      try {
        const stored = await getUserStorage()
        const phoneNumber = stored?.phoneNumber || ''
        if (cancelled || id !== loadId.current) return
        setOwner(phoneNumber)
        setUserType(stored?.userType)
        setPreview(Boolean(stored?.preview))

        const perUser = parsePreferences(await getStoredItem(storageKey(phoneNumber)))
        const legacy = phoneNumber ? null : parsePreferences(await getStoredItem(LEGACY_STORAGE_KEY))
        let next = perUser ?? legacy ?? DEFAULT_PREFERENCES

        // A PWID account can carry the privacy choice across devices.
        if (phoneNumber && stored?.userType === 'PWID' && !stored?.preview) {
          try {
            const profile = (await getUserData(phoneNumber)) as PWIDUser | null
            if (profile?.privacyMode) {
              const remote = normalizePreferences(profile)
              // The account is authoritative when it is newer than this device.
              if (remote.privacyUpdatedAt >= next.privacyUpdatedAt) {
                next = {
                  ...next,
                  privacyMode: remote.privacyMode,
                  privacyUpdatedAt: remote.privacyUpdatedAt
                }
              }
            }
          } catch (error) {
            console.error('Error loading privacy mode:', error)
          }
        }

        if (cancelled || id !== loadId.current) return
        setPreferences(next)
        lastSyncedMode.current = next.privacyMode
      } catch (error) {
        console.error('Error loading preferences:', error)
      } finally {
        if (!cancelled && id === loadId.current) setReady(true)
      }
    }

    load()
    const unsubscribe = subscribeSessionChanged(load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!ready || !owner) return
    setStoredItem(storageKey(owner), JSON.stringify(preferences)).catch(error => {
      console.error('Error saving preferences:', error)
    })
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('easy-read', preferences.easyRead)
    }
  }, [owner, preferences, ready])

  useEffect(() => {
    if (!ready || !owner || userType !== 'PWID' || preview) return
    if (lastSyncedMode.current === preferences.privacyMode) return
    lastSyncedMode.current = preferences.privacyMode
    updateUserData(owner, {
      privacyMode: preferences.privacyMode,
      privacyModeUpdatedAt: preferences.privacyUpdatedAt
    }).catch(error => {
      console.error('Error syncing privacy mode:', error)
    })
  }, [owner, preferences.privacyMode, preferences.privacyUpdatedAt, preview, ready, userType])

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences(current => {
      const next = normalizePreferences({ ...current, ...patch })
      if (patch.privacyMode && patch.privacyMode !== current.privacyMode) {
        next.privacyUpdatedAt = Date.now()
      }
      return next
    })
  }, [])

  const scale = useCallback(
    (size: number) => {
      const factor = preferences.textScale * (preferences.easyRead ? 1.08 : 1)
      return Math.round(size * factor)
    },
    [preferences.easyRead, preferences.textScale]
  )

  const bodyLine = useCallback(
    (size: number) => Math.round(scale(size) * (preferences.easyRead ? 1.65 : 1.5)),
    [preferences.easyRead, scale]
  )

  const value = useMemo(
    () => ({ preferences, ready, updatePreferences, scale, bodyLine }),
    [preferences, ready, updatePreferences, scale, bodyLine]
  )

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) {
    throw new Error('usePreferences must be used within PreferencesProvider')
  }
  return context
}
