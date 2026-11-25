'use client'

import type { PrivacyMode } from '../types'
import { getStoredItem, removeStoredItem, setStoredItem } from './localStore'

export type TripStage =
  | 'story'
  | 'waiting'
  | 'boarding'
  | 'on-bus'
  | 'arriving'
  | 'arrived'

export interface ActiveTrip {
  id: string
  travellerName: string
  travellerPhone?: string
  journeyId?: string
  destination: string
  origin: string
  stage: TripStage
  stepId?: string
  busNumber: string
  startedAt: number
  updatedAt: number
  caregiverName: string
  caregiverPhone: string
  practice: boolean
  privacyMode?: PrivacyMode
  destinationLatLng?: { lat: number; lng: number }
}

const TRIP_KEY = 'eb-active-trip'
export const ACTIVE_TRIP_TTL_MS = 6 * 60 * 60 * 1000
const ARRIVED_TRIP_TTL_MS = 30 * 60 * 1000

let currentTrip: ActiveTrip | null = null
let hydrationPromise: Promise<void> | null = null
let writeQueue = Promise.resolve()
const listeners = new Set<(trip: ActiveTrip | null) => void>()

function emit() {
  listeners.forEach(listener => listener(currentTrip))
}

function parseTrip(raw: string | null): ActiveTrip | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ActiveTrip
    if (!parsed || typeof parsed !== 'object' || !parsed.id) return null
    return parsed
  } catch {
    return null
  }
}

export function isTripExpired(trip: ActiveTrip, now = Date.now()): boolean {
  const ttl = trip.stage === 'arrived' ? ARRIVED_TRIP_TTL_MS : ACTIVE_TRIP_TTL_MS
  return !Number.isFinite(trip.updatedAt) || now - trip.updatedAt > ttl
}

/**
 * Load the trip once at app start. Screens can keep rendering while this runs;
 * subscribeToTrip emits again when hydration completes.
 */
export function initTripStore(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const stored = parseTrip(await getStoredItem(TRIP_KEY))
      if (stored && !isTripExpired(stored)) {
        currentTrip = stored
        emit()
      } else if (stored) {
        await removeStoredItem(TRIP_KEY)
      }
    })().catch(error => {
      console.error('Error loading active trip:', error)
    })
  }
  return hydrationPromise
}

export function getActiveTrip(): ActiveTrip | null {
  if (currentTrip && isTripExpired(currentTrip)) {
    currentTrip = null
    void removeStoredItem(TRIP_KEY)
  }
  return currentTrip
}

export function setActiveTrip(trip: ActiveTrip | null) {
  currentTrip = trip
  emit()
  writeQueue = writeQueue
    .then(() => (trip ? setStoredItem(TRIP_KEY, JSON.stringify(trip)) : removeStoredItem(TRIP_KEY)))
    .catch(error => {
      console.error('Error saving active trip:', error)
    })
}

export function subscribeToTrip(callback: (trip: ActiveTrip | null) => void) {
  listeners.add(callback)
  callback(getActiveTrip())
  return () => {
    listeners.delete(callback)
  }
}

export function createTripId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `trip-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function stageLabel(stage: TripStage): string {
  switch (stage) {
    case 'story':
      return 'Ready to go'
    case 'waiting':
      return 'Waiting at the stop'
    case 'boarding':
      return 'Boarding now'
    case 'on-bus':
      return 'On the bus'
    case 'arriving':
      return 'Almost there'
    case 'arrived':
      return 'Arrived'
  }
}
