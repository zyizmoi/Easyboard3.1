'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import notificationService from '../services/notificationService'
import { usePreferences } from './PreferencesContext'
import { getUserStorage } from '../services/storageService'
import { subscribeSessionChanged } from '../services/sessionEvents'
import { getActiveTrip, subscribeToTrip, type ActiveTrip } from '../services/tripStore'
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
  const watchIdRef = useRef<number | null>(null)
  const notifiedShareRef = useRef(false)
  const stopReasonRef = useRef<string | undefined>(undefined)
  const permissionDeniedRef = useRef(false)
  const destinationRef = useRef<{ lat: number; lng: number } | null>(null)
  const privacyModeRef = useRef(preferences.privacyMode)

  useEffect(() => subscribeToTrip(setActiveTrip), [])

  useEffect(() => {
    destinationRef.current = destination
  }, [destination])

  useEffect(() => {
    privacyModeRef.current = preferences.privacyMode
  }, [preferences.privacyMode])

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
      console.error('Error sending notification to caregiver:', error)
    }
  }, [pwidPhoneNumber])

  const sendStopNotificationToCaregiver = useCallback(
    async (reason?: string) => {
      try {
        if (!pwidPhoneNumber) return
        const pwidUser = await getUserData(pwidPhoneNumber)
        if (pwidUser && pwidUser.userType === 'PWID') {
          const pwid = pwidUser as PWIDUser
          if (pwid.caregiverPhone) {
            await notificationService.sendLocationStopNotification(
              pwidPhoneNumber,
              pwid.caregiverPhone,
              reason || 'Location sharing stopped'
            )
          }
        }
      } catch (error) {
        console.error('Error sending stop notification to caregiver:', error)
      }
    },
    [pwidPhoneNumber]
  )

  // Start or stop according to the user's saved mode. This does not depend on
  // the current sharing boolean, so a permission error cannot cause a retry loop.
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
    // A timeout or weak signal is transient. Do not let its banner block the
    // next trip from starting the watch.
    if (!permissionDeniedRef.current && !autoStopped) setIsLocationSharingState(true)
  }, [activeTrip, autoStopped, preferences.privacyMode, preview, ready, userType])

  useEffect(() => {
    if (!isLocationSharing || !pwidPhoneNumber || userType !== 'PWID' || preview) {
      const wasSharing = watchIdRef.current !== null
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (pwidPhoneNumber && wasSharing) {
        stopPWIDLocationSharing(pwidPhoneNumber).catch(() => {})
        if (notifiedShareRef.current) {
          void sendStopNotificationToCaregiver(stopReasonRef.current)
          notifiedShareRef.current = false
        }
        stopReasonRef.current = undefined
      }
      return
    }

    if (!navigator.geolocation) {
      setSharingError('This browser does not support location.')
      setPermissionDenied(true)
      permissionDeniedRef.current = true
      setIsLocationSharingState(false)
      return
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      async position => {
        try {
          if (!notifiedShareRef.current) {
            notifiedShareRef.current = true
            void sendShareNotificationToCaregiver()
          }
          setSharingError(null)
          await updatePWIDLocation(pwidPhoneNumber, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            updatedAt: Date.now(),
            isSharing: true
          })

          const target = destinationRef.current
          if (target) {
            const distance = getDistanceFromLatLonInMeters(
              position.coords.latitude,
              position.coords.longitude,
              target.lat,
              target.lng
            )
            if (distance < 20) {
              setDestinationState(null)
              if (privacyModeRef.current !== 'always') {
                stopReasonRef.current = 'Arrived at destination'
                setAutoStopped(true)
                setIsLocationSharingState(false)
              }
            }
          }
        } catch (error) {
          console.error('Error updating location:', error)
          setSharingError('Could not update your location.')
        }
      },
      error => {
        console.error('Geolocation error:', error)
        const denied = error.code === error.PERMISSION_DENIED
        if (!denied) {
          // Timeouts are routine indoors and in interchanges. Keep the watch
          // alive and keep the shared trip alive; a later fix can arrive.
          setSharingError(
            error.code === error.TIMEOUT
              ? 'Your location is updating slowly. Keep following your steps.'
              : 'Your location is weak right now. Keep following your steps.'
          )
          return
        }
        permissionDeniedRef.current = true
        setPermissionDenied(true)
        setSharingError('Location permission is off. Allow location in your browser settings.')
        setIsLocationSharingState(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      if (pwidPhoneNumber) {
        stopPWIDLocationSharing(pwidPhoneNumber).catch(() => {})
        if (notifiedShareRef.current) {
          void sendStopNotificationToCaregiver(stopReasonRef.current)
          notifiedShareRef.current = false
        }
        stopReasonRef.current = undefined
      }
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
