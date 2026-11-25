import { getStoredItem, removeStoredItem, setStoredItem } from './localStore'

const AUTO_STOP_TTL_MS = 6 * 60 * 60 * 1000
const key = (phoneNumber: string) => `eb-location-auto-stop:${phoneNumber}`

export interface LocationAutoStop {
  phoneNumber: string
  reason: string
  at: number
}

/**
 * The background location task cannot update React state. It leaves this
 * marker so the app can reconcile the screen and avoid starting sharing again
 * after the person has already arrived.
 */
export async function markLocationAutoStop(
  phoneNumber: string,
  reason: string
): Promise<void> {
  if (!phoneNumber) return
  try {
    const marker: LocationAutoStop = { phoneNumber, reason, at: Date.now() }
    await setStoredItem(key(phoneNumber), JSON.stringify(marker))
  } catch (error) {
    console.error('Error saving location auto-stop:', error)
  }
}

export async function readLocationAutoStop(
  phoneNumber: string
): Promise<LocationAutoStop | null> {
  if (!phoneNumber) return null
  try {
    const raw = await getStoredItem(key(phoneNumber))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocationAutoStop>
    if (
      parsed.phoneNumber !== phoneNumber ||
      typeof parsed.reason !== 'string' ||
      typeof parsed.at !== 'number'
    ) {
      return null
    }
    if (Date.now() - parsed.at > AUTO_STOP_TTL_MS) return null
    return { phoneNumber, reason: parsed.reason, at: parsed.at }
  } catch (error) {
    console.error('Error reading location auto-stop:', error)
    return null
  }
}

export async function clearLocationAutoStop(phoneNumber: string): Promise<void> {
  if (!phoneNumber) return
  try {
    await removeStoredItem(key(phoneNumber))
  } catch (error) {
    console.error('Error clearing location auto-stop:', error)
  }
}
