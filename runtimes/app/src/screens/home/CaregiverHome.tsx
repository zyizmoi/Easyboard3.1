'use client'

import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, useWindowDimensions, View } from 'react-native'
import { Text } from '../../components'
import { ActionButton, AppFrame, Toast } from '../../components/ui'
import { usePreferences } from '../../contexts/PreferencesContext'
import { useToast } from '../../hooks/useToast'
import notificationService from '../../services/notificationService'
import { getUserStorage } from '../../services/storageService'
import { isTripExpired, stageLabel, type ActiveTrip } from '../../services/tripStore'
import {
  getPWIDsByCaregiverPhone,
  listenToPWIDLocation,
  subscribeToActiveTrip
} from '../../services/userService'
import { colors, font, radius, shadow, space } from '../../theme/tokens'
import type { PWIDUser, UserLocation } from '../../types'

const BOARDING_WAIT_MS = 3 * 60 * 1000
const LOCATION_FRESH_MS = 2 * 60 * 1000

export function CaregiverHome() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { scale, bodyLine } = usePreferences()
  const { message, showToast } = useToast()

  const [pwids, setPwids] = useState<PWIDUser[]>([])
  const [remoteTrips, setRemoteTrips] = useState<Record<string, ActiveTrip | null>>({})
  const [locations, setLocations] = useState<Record<string, UserLocation>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)

  const isWide = width >= 980
  const narrow = width < 360

  const load = useCallback(async () => {
    try {
      const stored = await getUserStorage()
      if (!stored?.phoneNumber) return
      if (stored.preview) {
        setPwids([])
        return
      }
      const list = await getPWIDsByCaregiverPhone(stored.phoneNumber)
      const unique = Array.from(
        new Map(list.map(person => [person.phoneNumber, person])).values()
      )
      setPwids(unique)
      setLocations(current => {
        const next = { ...current }
        unique.forEach(person => {
          if (person.location) next[person.phoneNumber] = person.location
        })
        return next
      })
      setRemoteTrips(current => {
        const next = { ...current }
        unique.forEach(person => {
          if (person.activeTrip) next[person.phoneNumber] = person.activeTrip
        })
        return next
      })
    } catch (error) {
      console.error('Error loading caregiver home:', error)
      showToast('Could not refresh the people you support.')
    }
  }, [showToast])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  useEffect(() => {
    if (pwids.length === 0) return
    const unsubscribers = pwids.flatMap(person => [
      subscribeToActiveTrip(person.phoneNumber, trip => {
        setRemoteTrips(current => ({ ...current, [person.phoneNumber]: trip }))
      }),
      listenToPWIDLocation(person.phoneNumber, location => {
        setLocations(current => ({ ...current, [person.phoneNumber]: location }))
      })
    ])
    return () => unsubscribers.forEach(unsubscribe => unsubscribe())
  }, [pwids])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    notificationService
      .checkPermissions()
      .then(setNotificationsEnabled)
      .catch(error => console.error('Error checking notification permission:', error))
  }, [])

  const enableNotifications = useCallback(async () => {
    try {
      const token = await notificationService.initialize()
      if (token) {
        setNotificationsEnabled(true)
        showToast('Notifications are on.')
      } else {
        showToast('Notifications are still off. Allow them in phone settings.')
      }
    } catch (error) {
      console.error('Error enabling notifications:', error)
      showToast('Could not turn on notifications.')
    }
  }, [showToast])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const tripsByPhone = useMemo(() => {
    const map = new Map<string, ActiveTrip>()
    pwids.forEach(person => {
      const trip = Object.prototype.hasOwnProperty.call(remoteTrips, person.phoneNumber)
        ? remoteTrips[person.phoneNumber]
        : person.activeTrip ?? null
      if (trip && !isTripExpired(trip, now)) map.set(person.phoneNumber, trip)
    })
    return map
  }, [now, pwids, remoteTrips])

  const boardingChecks = pwids
    .map(person => ({ person, trip: tripsByPhone.get(person.phoneNumber) }))
    .filter(
      entry =>
        entry.trip?.stage === 'waiting' &&
        entry.trip.stepId === 'wait' &&
        now - entry.trip.updatedAt > BOARDING_WAIT_MS
    )

  const call = useCallback(
    (phone: string) => {
      if (!phone) {
        showToast('No phone number saved.')
        return
      }
      Linking.openURL(`tel:${phone}`).catch(() => showToast(`Call ${phone}`))
    },
    [showToast]
  )

  const showPeople = pwids.length > 0

  return (
    <AppFrame
      statusLabel='Caregiver view'
      statusAction='none'
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <View style={{ gap: space.lg, width: '100%', maxWidth: 820, marginHorizontal: 'auto' }}>
        <View style={{ gap: space.lg, width: '100%', minWidth: 0 }}>
          <View style={{ gap: 8 }}>
            <Text
              style={{
                fontFamily: font.display,
                fontSize: scale(isWide ? 44 : 34),
                lineHeight: scale(isWide ? 48 : 38),
                letterSpacing: -0.5,
                color: colors.ink
              }}
            >
              People you support.
            </Text>

            {!notificationsEnabled ? (
              <ActionButton
                label='Turn on notifications'
                icon='notifications-outline'
                variant='ghost'
                size='sm'
                onPress={enableNotifications}
                accessibilityHint='Asks the phone for notification permission'
              />
            ) : null}

            {showPeople ? (
              <Pressable
                accessibilityRole='button'
                accessibilityLabel='Set up a journey'
                onPress={() => router.navigate('/journeys')}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.line,
                  borderRadius: radius.lg,
                  padding: 16,
                  boxShadow: shadow.card,
                  opacity: pressed ? 0.8 : 1
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    backgroundColor: colors.brandSoft,
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Ionicons name='add-circle-outline' size={scale(23)} color={colors.brand} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: scale(16), fontWeight: '800', color: colors.ink }}>
                    Set up a journey
                  </Text>
                  <Text style={{ fontSize: scale(13), lineHeight: bodyLine(13), color: colors.muted }}>
                    Photos and steps.
                  </Text>
                </View>
                <Ionicons name='chevron-forward' size={scale(20)} color={colors.faint} />
              </Pressable>
            ) : null}
          </View>

          {boardingChecks.map(({ person, trip }) => {
            if (!trip) return null
            const name = person.name?.trim() || trip.travellerName || 'Your person'
            const phone = trip.travellerPhone || person.phoneNumber
            return (
              <View
                key={`boarding-${person.phoneNumber}`}
                style={{
                  backgroundColor: colors.warningSoft,
                  borderWidth: 1,
                  borderColor: '#E7CFA6',
                  borderRadius: radius.lg,
                  padding: 18,
                  gap: 10
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name='bus-outline' size={scale(22)} color={colors.warning} />
                  <Text style={{ fontSize: scale(13), fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: colors.warning }}>
                    Boarding check
                  </Text>
                </View>
                <Text style={{ fontSize: scale(20), fontWeight: '800', color: colors.ink }}>
                  No boarding confirmation from {name}.
                </Text>
                <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.inkSoft }}>
                  Call {name} if they need help.
                </Text>
                <ActionButton
                  label={`Call ${name}`}
                  icon='call-outline'
                  onPress={() => call(phone)}
                />
              </View>
            )
          })}

          {loading ? (
            <View style={{ padding: 24 }}>
              <Text style={{ color: colors.muted, fontSize: scale(15) }}>Loading…</Text>
            </View>
          ) : showPeople ? (
            <View style={{ gap: 12 }}>
              {pwids.map(person => {
                const rawName = person.name?.trim() || 'Your person'
                const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
                const phone = person.phoneNumber || ''
                const trip = tripsByPhone.get(phone) ?? null
                const location = locations[phone] ?? person.location
                const locationAge = location ? now - location.updatedAt : Infinity
                const recentLocation = Boolean(location && locationAge < LOCATION_FRESH_MS)
                const privacyMode = trip?.privacyMode ?? person.privacyMode
                const isPaused = privacyMode === 'paused'
                const isSharing = !isPaused && recentLocation && Boolean(location?.isSharing)
                const seenAt = location ? new Date(location.updatedAt) : null
                const seenLabel = seenAt && !Number.isNaN(seenAt.getTime())
                  ? `Last seen ${seenAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'No update yet'
                const statusLine = trip
                  ? `${stageLabel(trip.stage)} · updated ${new Date(trip.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${trip.privacyMode === 'always' ? 'Always' : 'Trip only'}`
                  : location
                    ? seenLabel
                    : 'No active trip'
                const modeLabel = privacyMode === 'always' ? 'Always' : 'Trip only'
                const sharingLabel = isPaused
                  ? 'Paused'
                  : isSharing
                    ? 'Sharing'
                    : trip
                      ? `Waiting for location · ${modeLabel}`
                      : 'Not sharing'

                return (
                  <View
                    key={phone || name}
                    style={{
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: radius.xl,
                      padding: 20,
                      gap: 14,
                      boxShadow: shadow.card
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          backgroundColor: colors.brandSoft,
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <Text style={{ fontSize: scale(18), fontWeight: '800', color: colors.brand }}>
                          {name.slice(0, 1).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                          <Text style={{ fontSize: scale(19), fontWeight: '800', color: colors.ink }}>{name}</Text>
                          {phone ? (
                            <Text style={{ fontSize: scale(12), fontWeight: '600', color: colors.faint }}>
                              •••• {phone.slice(-4)}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={{ fontSize: scale(13), lineHeight: bodyLine(13), color: colors.muted }}>
                          {statusLine}
                        </Text>
                      </View>
                      {!narrow ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 5,
                            backgroundColor: isSharing ? colors.successSoft : colors.surfaceMuted,
                            borderRadius: radius.pill,
                            paddingHorizontal: 9,
                            paddingVertical: 5
                          }}
                        >
                          <View
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: isSharing ? colors.success : colors.muted
                            }}
                          />
                          <Text style={{ fontSize: scale(11), fontWeight: '800', color: isSharing ? colors.success : colors.muted }}>
                            {sharingLabel}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {trip ? (
                      <View style={{ gap: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <Text style={{ fontSize: scale(13), fontWeight: '700', color: colors.muted }}>
                            To {trip.destination}
                          </Text>
                          <Text style={{ fontSize: scale(13), fontWeight: '700', color: colors.brand }}>
                            {stageLabel(trip.stage)}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', gap: 4 }}>
                          {['Waiting', 'On the bus', 'Arrived'].map((label, stepIndex) => {
                            const activeIndex = trip.stage === 'waiting' ? 0 : trip.stage === 'arrived' ? 2 : 1
                            const active = stepIndex <= activeIndex
                            return (
                              <View key={label} style={{ flex: 1, gap: 4 }}>
                                <View
                                  style={{
                                    height: 6,
                                    borderRadius: 3,
                                    backgroundColor: active ? colors.brand : colors.surfaceMuted
                                  }}
                                />
                                <Text style={{ fontSize: scale(10), fontWeight: '600', color: active ? colors.inkSoft : colors.faint }}>
                                  {label}
                                </Text>
                              </View>
                            )
                          })}
                        </View>
                      </View>
                    ) : null}

                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <ActionButton
                        label='Call'
                        icon='call-outline'
                        variant='secondary'
                        size='sm'
                        onPress={() => call(phone)}
                        style={{ flex: 1 }}
                      />
                      {location ? (
                        <ActionButton
                          label={recentLocation ? 'Location' : 'Last location'}
                          icon='locate-outline'
                          variant='secondary'
                          size='sm'
                          accessibilityHint={`See where ${name} was last seen`}
                          onPress={() => router.navigate(`/track-pwid?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`)}
                          disabled={!phone}
                          style={{ flex: 1 }}
                        />
                      ) : (
                        <ActionButton
                          label='Journey'
                          icon='add-circle-outline'
                          variant='secondary'
                          size='sm'
                          accessibilityHint={`Set up a journey for ${name}`}
                          onPress={() => router.navigate(`/journeys?phone=${encodeURIComponent(phone)}`)}
                          disabled={!phone}
                          style={{ flex: 1 }}
                        />
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          ) : (
            <View
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.line,
                borderRadius: radius.lg,
                padding: 24,
                gap: 8
              }}
            >
              <Text style={{ fontSize: scale(18), fontWeight: '800', color: colors.ink }}>
                No one linked yet
              </Text>
              <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.muted }}>
                People who add your phone number as their caregiver will appear here.
              </Text>
            </View>
          )}
        </View>
      </View>
      <Toast message={message} />
    </AppFrame>
  )
}
