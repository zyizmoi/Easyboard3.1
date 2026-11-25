import type { Journey, PWIDUser } from '../types'
import {
  deletePWIDJourney,
  getUserData,
  savePWIDJourney
} from './userService'

function sorted(journeys: Journey[]) {
  return [...journeys].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getJourneys(pwidPhone: string): Promise<Journey[]> {
  if (!pwidPhone) return []
  const user = await getUserData(pwidPhone)
  if (!user || user.userType !== 'PWID') return []
  return sorted((user as PWIDUser).journeys ?? [])
}

export async function saveJourney(
  pwidPhone: string,
  journey: Journey
): Promise<Journey[]> {
  const next = await savePWIDJourney(pwidPhone, journey)
  return sorted(next)
}

export async function deleteJourney(
  pwidPhone: string,
  journeyId: string
): Promise<Journey[]> {
  const next = await deletePWIDJourney(pwidPhone, journeyId)
  return sorted(next)
}
