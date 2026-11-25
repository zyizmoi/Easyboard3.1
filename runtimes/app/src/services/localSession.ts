import { localStore } from './localStore'
import { setActiveTrip } from './tripStore'

const PREFERENCE_PREFIX = 'eb-preferences:'
const SESSION_KEYS: Record<string, true> = {
  'eb-active-trip': true,
  'eb-preferences': true,
  UserStorageData: true,
  setting: true,
  fcmToken: true,
  notificationToken: true,
  recaptchaToken: true,
  authToken: true,
  sessionData: true,
  userPreferences: true,
  cachedLocation: true,
  lastKnownLocation: true
}

/** Remove local data that belongs to the person who just signed out. */
export async function clearLocalSessionData() {
  try {
    const keys = await localStore.getAllKeys()
    const toRemove = keys.filter(
      key => SESSION_KEYS[key] || key.startsWith(PREFERENCE_PREFIX)
    )
    if (toRemove.length > 0) await localStore.removeItems(toRemove)
    setActiveTrip(null)
  } catch (error) {
    console.error('Error clearing local session data:', error)
  }
}
