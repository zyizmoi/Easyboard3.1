import { getStoredItem, setStoredItem } from './localStore'
import type { Journey } from '../types'

const cacheKey = (phoneNumber: string) => `eb-journey-cache:${phoneNumber}`

/** Keep a small local copy so a trip can start in a dead zone. */
export async function cacheJourneys(phoneNumber: string, journeys: Journey[]): Promise<void> {
  if (!phoneNumber) return
  try {
    await setStoredItem(cacheKey(phoneNumber), JSON.stringify(journeys))
  } catch (error) {
    console.error('Error caching journeys:', error)
  }
}

export async function getCachedJourneys(phoneNumber: string): Promise<Journey[]> {
  if (!phoneNumber) return []
  try {
    const raw = await getStoredItem(cacheKey(phoneNumber))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Journey[]) : []
  } catch (error) {
    console.error('Error reading cached journeys:', error)
    return []
  }
}

export function findCachedJourney(journeys: Journey[], journeyId: string): Journey | null {
  return journeys.find(journey => journey.id === journeyId) ?? null
}
