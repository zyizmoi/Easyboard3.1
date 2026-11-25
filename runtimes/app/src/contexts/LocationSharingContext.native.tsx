import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Alert, AppState } from 'react-native'
import notificationService from '../services/notificationService'
import { usePreferences } from './PreferencesContext'
import { getUserStorage } from '../services/storageService'
import { subscribeSessionChanged } from '../services/sessionEvents'
import { getActiveTrip, initTripStore, subscribeToTrip, type ActiveTrip } from '../services/tripStore'
import {
  getUserData,
  stopPWIDLocationSharing,
  updatePWIDLocation
} from '../services/userService'
import type { PWIDUser } from '../types'

type LocationSharingContextType = {
  isLocationSharing: boolean
  setIsLocationSharing: (share: boolean) => void
  setDestination: (dest: { lat: number; lng: number } | null) => void
  destination: { lat: number; lng: number } | null
  permissionDenied: boolean
  sharingError: string | null
  autoStopped: boolean
  retrySharing: () => void
  resetAutoStop: () => void
}

const LocationSharingContext = createContext<LocationSharingContextType | undefined>(undefined)
const BACKGROUND_TASK = 'background_location'

const backgroundState: {
  phone: string | null
  destination: { lat: number; lng: number } | null
  privacyMode: string
  stoppedPhone: string | null
} = {
  phone: null,
  destination: null,
  privacyMode: 'trip-only',
  stoppedPhone: null
}

function getDistanceFromLatLonInMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Expo requires this at module scope. If the OS relaunches the app in the
// background after it was killed, this file runs and the task is available.
if (!TaskManager.isTaskDefined(BACKGROUND_TASK)) {
  TaskManager.defineTask(BACKGROUND_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Background location error:', error.message)
      return
    }
    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations
    const loc = locations?.[0]
    if (!loc) return
    try {
      await initTripStore()
      const stored = backgroundState.phone ? null : await getUserStorage()
      const phone = backgroundState.phone || stored?.phoneNumber || getActiveTrip()?.travellerPhone || null
      if (!phone) return
      const trip = getActiveTrip()
      await updatePWIDLocation(phone, {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        updatedAt: Date.now(),
        isSharing: true
      })
      const target = backgroundState.destination || trip?.destinationLatLng || null
      const privacyMode = backgroundState.privacyMode || trip?.privacyMode || 'trip-only'
      if (target && privacyMode !== 'always') {
        const distance = getDistanceFromLatLonInMeters(
          loc.coords.latitude,
          loc.coords.longitude,
          target.lat,
          target.lng
        )
        if (distance < 20) {
          await stopPWIDLocationSharing(phone)
          if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
            await Location.stopLocationUpdatesAsync(BACKGROUND_TASK)
          }
          backgroundState.destination = null
          backgroundState.stoppedPhone = phone
        }
      }
    } catch (updateError) {
      console.error('Error updating background location:', updateError)
    }
  })
}

export const LocationSharingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { preferences, ready } = usePreferences()
  const [isLocationSharing, setIsLocationSharingState] = useState(false)
  const [pwidPhoneNumber, setPwidPhoneNumber] = useState<string | null>(null)
  const [userType, setUserType] = useState<string | undefined>()
  const [preview, setPreview] = useState(false)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [sharingError, setSharingError] = useState<string | null>(null)
  const [autoStopped, setAutoStopped] = useState(false)
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(getActiveTrip)
  const [destination, setDestinationState] = useState<{ lat: number; lng: number } | null>(null)

  const permissionDeniedRef = useRef(false)
  const notifiedShareRef = useRef(false)
  const hasStartedSharingRef = useRef(false)
  const startAttemptRef = useRef(0)
  const stopReasonRef = useRef<string | undefined>(undefined)
  const pwidPhoneRef = useRef<string | null>(null)

  useEffect(() => {
    backgroundState.destination = destination
  }, [destination])

  useEffect(() => {
    backgroundState.privacyMode = preferences.privacyMode
  }, [preferences.privacyMode])

  useEffect(() => {
    const phone = pwidPhoneNumber
    pwidPhoneRef.current = phone
    backgroundState.phone = phone
  }, [pwidPhoneNumber])

  useEffect(() => subscribeToTrip(setActiveTrip), [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLocationSharingState(false)
      setPermissionDenied(false)
      permissionDeniedRef.current = false
      setSharingError(null)
      setAutoStopped(false)
      const stored = await getUserStorage()
      if (cancelled) return
      setPwidPhoneNumber(stored?.phoneNumber || null)
      setUserType(stored?.userType)
      setPreview(Boolean(stored?.preview))
      if (stored?.userType !== 'PWID') {
        setIsLocationSharingState(false)
        setPermissionDenied(false)
        permissionDeniedRef.current = false
        setSharingError(null)
      }
    }
    load().catch(error => console.error('Error loading location session:', error))
    const unsubscribe = subscribeSessionChanged(load)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // A background auto-stop cannot call React state setters from a headless
  // context. When the app returns, reconcile the visible state.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return
      if (backgroundState.stoppedPhone && backgroundState.stoppedPhone === pwidPhoneRef.current) {
        backgroundState.stoppedPhone = null
        setDestinationState(null)
        setAutoStopped(true)
        setIsLocationSharingState(false)
      }
    })
    return () => subscription.remove()
  }, [])

  const sendShareNotificationToCaregiver = useCallback(async () => {
    try {
      if (!pwidPhoneNumber) return
      const pwidUser = await getUserData(pwidPhoneNumber)
      if (pwidUser && pwidUser.userType === 'PWID') {
        const pwid = pwidUser as PWIDUser
        if (pwid.caregiverPhone) {
          await notificationService.sendLocationShareNotification(pwidPhoneNumber, pwid.caregiverPhone)
        }
      }
    } catch (error) {
      console.error('Error sending location share notification:', error)
    }
  }, [pwidPhoneNumber])

  const sendStopNotificationToCaregiver = useCallback(async () => {
    try {
      if (!pwidPhoneNumber) return
      const pwidUser = await getUserData(pwidPhoneNumber)
      if (pwidUser && pwidUser.userType === 'PWID') {
        const pwid = pwidUser as PWIDUser
        if (pwid.caregiverPhone) {
          await notificationService.sendLocationStopNotification(
            pwidPhoneNumber,
            pwid.caregiverPhone,
            stopReasonRef.current || 'Location sharing stopped'
          )
        }
      }
    } catch (error) {
      console.error('Error sending stop notification to caregiver:', error)
    } finally {
      stopReasonRef.current = undefined
    }
  }, [pwidPhoneNumber])

  // Only a PWID account starts sharing automatically. Caregivers never share.
  useEffect(() => {
    if (!ready) return
    if (preview || userType !== 'PWID' || preferences.privacyMode === 'paused') {
      setIsLocationSharingState(false)
      return
    }
    const tripIsActive = Boolean(activeTrip && activeTrip.stage !== 'arrived')
    const shouldShare =
      preferences.privacyMode === 'always' ||
      (preferences.privacyMode === 'trip-only' && tripIsActive)
    if (!shouldShare) {
      setIsLocationSharingState(false)
      return
    }
    if (!permissionDeniedRef.current && !sharingError && !autoStopped) setIsLocationSharingState(true)
  }, [activeTrip, autoStopped, preferences.privacyMode, preview, ready, sharingError, userType])

  useEffect(() => {
    const stopLocationUpdates = async () => {
      try {
        if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_TASK)
        }
      } catch (error) {
        console.error('Error stopping background location:', error)
      }
    }

    const stopSharing = async () => {
      await stopLocationUpdates()
      if (!hasStartedSharingRef.current || !pwidPhoneNumber) return
      hasStartedSharingRef.current = false
      stopPWIDLocationSharing(pwidPhoneNumber).catch(() => {})
      if (notifiedShareRef.current) {
        void sendStopNotificationToCaregiver()
        notifiedShareRef.current = false
      }
    }

    const attempt = ++startAttemptRef.current

    if (!isLocationSharing || !pwidPhoneNumber || userType !== 'PWID' || preview) {
      void stopSharing()
      return
    }

    const startSharing = async () => {
      // A background relaunch may already have the task running. Do not start
      // a second one or send a duplicate share notification.
      if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK)) {
        if (attempt === startAttemptRef.current) {
          hasStartedSharingRef.current = true
          notifiedShareRef.current = true
        }
        return
      }

      const foreground = await Location.getForegroundPermissionsAsync()
      const background = await Location.getBackgroundPermissionsAsync()
      if (attempt !== startAttemptRef.current) return
      const foregroundGranted = foreground.granted
        ? true
        : (await Location.requestForegroundPermissionsAsync()).granted
      if (attempt !== startAttemptRef.current) return
      const backgroundGranted = background.granted
        ? true
        : (await Location.requestBackgroundPermissionsAsync()).granted
      if (attempt !== startAttemptRef.current) return

      if (!foregroundGranted || !backgroundGranted) {
        permissionDeniedRef.current = true
        setPermissionDenied(true)
        setSharingError('Allow location for this app to share your trip.')
        setIsLocationSharingState(false)
        Alert.alert('Location is off', 'Allow location for EasyBoard to share your trip. You can turn it on in phone Settings.')
        return
      }

      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: 'Location sharing active',
            notificationBody: 'You are sharing this trip with your caregiver.',
            notificationColor: '#1D5BB8'
          }
        })
        hasStartedSharingRef.current = true

        // The trip may have ended while the permission prompts were open.
        if (attempt !== startAttemptRef.current) {
          await stopSharing()
          return
        }

        await sendShareNotificationToCaregiver()
        if (attempt === startAttemptRef.current) {
          notifiedShareRef.current = true
        }
      } catch (error) {
        console.error('Error starting location sharing:', error)
        hasStartedSharingRef.current = false
        setSharingError('Could not start location sharing. Check your phone settings.')
        setIsLocationSharingState(false)
      }
    }

    void startSharing()

    return () => {
      startAttemptRef.current += 1
      void stopSharing()
    }
  }, [
    isLocationSharing,
    pwidPhoneNumber,
    sendShareNotificationToCaregiver,
    sendStopNotificationToCaregiver,
    preview,
    userType
  ])

  const setIsLocationSharing = useCallback((share: boolean) => {
    if (share && permissionDeniedRef.current) return
    setIsLocationSharingState(share)
  }, [])

  const resetAutoStop = useCallback(() => setAutoStopped(false), [])

  const retrySharing = useCallback(() => {
    setAutoStopped(false)
    permissionDeniedRef.current = false
    setPermissionDenied(false)
    setSharingError(null)
    setIsLocationSharingState(true)
  }, [])

  const setDestination = useCallback((dest: { lat: number; lng: number } | null) => {
    if (dest) setAutoStopped(false)
    setDestinationState(dest)
  }, [])

  return (
    <LocationSharingContext.Provider
      value={{
        isLocationSharing,
        setIsLocationSharing,
        destination,
        setDestination,
        permissionDenied,
        sharingError,
        autoStopped,
        resetAutoStop,
        retrySharing
      }}
    >
      {children}
    </LocationSharingContext.Provider>
  )
}

export const useLocationSharing = () => {
  const context = useContext(LocationSharingContext)
  if (!context) {
    throw new Error('useLocationSharing must be used within a LocationSharingProvider')
  }
  return context
}
