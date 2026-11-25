'use client'

import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { Text } from '../../components'
import { ActionButton, AppFrame, PlaceCard, Toast, Toggle } from '../../components/ui'
import { usePreferences } from '../../contexts/PreferencesContext'
import { useLocationSharing } from '../../contexts/LocationSharingContext'
import { useCallCaregiver } from '../../hooks/useCallCaregiver'
import { useToast } from '../../hooks/useToast'
import {
  getPhotoDownloadUrl,
  getUserStorage,
  type UserStorage
} from '../../services/storageService'
import {
  getActiveTrip,
  initTripStore,
  stageLabel,
  subscribeToTrip,
  type ActiveTrip
} from '../../services/tripStore'
import { getUserData } from '../../services/userService'
import { colors, font, radius, shadow, space } from '../../theme/tokens'
import type { Journey, PWIDUser, SavedPlace } from '../../types'

interface CaregiverSummary {
  name?: string
  phone?: string
}

interface HomePlace {
  key: string
  locationName: string
  address?: string
  imageKey?: string
  icon: keyof typeof Ionicons.glyphMap
  journeyId?: string
  latlng?: { latitude: number; longitude: number }
}

function placeIcon(name: string): keyof typeof Ionicons.glyphMap {
  if (name === 'Home') return 'home-outline'
  if (name === 'School') return 'school-outline'
  return 'briefcase-outline'
}

function savedPlaceToHome(place: SavedPlace): HomePlace {
  return {
    key: `saved-${place.locationName}-${place.address?.description || ''}`,
    locationName: place.locationName,
    address: place.address?.description,
    imageKey: place.locationImageKey,
    icon: placeIcon(place.locationName),
    latlng: place.address?.latlng
      ? {
          latitude: place.address.latlng.latitude,
          longitude: place.address.latlng.longitude
        }
      : undefined
  }
}

export function PWIDHome() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { scale, bodyLine, preferences, updatePreferences } = usePreferences()
  const { isLocationSharing } = useLocationSharing()
  const { message, showToast } = useToast()
  const callCaregiver = useCallCaregiver()

  const [userData, setUserData] = useState<UserStorage | null>(null)
  const [caregiver, setCaregiver] = useState<CaregiverSummary>({})
  const [journeys, setJourneys] = useState<Journey[]>([])
  const [activeTrip, setActiveTrip] = useState<ActiveTrip | null>(getActiveTrip)
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const isWide = width >= 980

  const load = useCallback(async () => {
    try {
      const stored = await getUserStorage()
      setUserData(stored)
      const storedPwid = stored as unknown as PWIDUser | null
      const isPreview = Boolean((stored as { preview?: boolean } | null)?.preview)

      if (storedPwid?.phoneNumber && !isPreview) {
        const ownData = await getUserData(storedPwid.phoneNumber)
        setJourneys((ownData as PWIDUser | null)?.journeys ?? [])
      }

      if (storedPwid?.caregiverPhone) {
        setCaregiver({ phone: storedPwid.caregiverPhone })
        if (!isPreview) {
          const caregiverData = await getUserData(storedPwid.caregiverPhone)
          if (caregiverData?.name) {
            setCaregiver({ name: caregiverData.name, phone: storedPwid.caregiverPhone })
          }
        }
      }
    } catch (error) {
      console.error('Error loading home data:', error)
      showToast('Could not refresh your places.')
    }
  }, [showToast])

  useEffect(() => {
    initTripStore().catch(error => console.error('Error loading saved trip:', error))
    load().finally(() => setLoading(false))
  }, [load])

  useEffect(() => subscribeToTrip(setActiveTrip), [])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  const savedPlaces = useMemo(() => {
    if (userData?.userType !== 'PWID') return []
    const pwid = userData as unknown as PWIDUser
    const places = (pwid.savedPlaces ?? []).map(savedPlaceToHome)
    const journeyPlaces: HomePlace[] = journeys.map(journey => {
      const matchedPlace = places.find(
        place => place.locationName.trim().toLowerCase() === journey.destinationName.trim().toLowerCase()
      )
      return {
        key: `journey-${journey.id}`,
        locationName: journey.destinationName,
        address: matchedPlace?.address,
        imageKey: matchedPlace?.imageKey,
        icon: 'bus-outline',
        journeyId: journey.id,
        latlng: journey.destinationLatLng ?? matchedPlace?.latlng
      }
    })
    return [...places, ...journeyPlaces]
  }, [journeys, userData])

  useEffect(() => {
    let cancelled = false
    const loadPhotos = async () => {
      const entries = await Promise.all(
        savedPlaces.map(async place => {
          if (!place.imageKey) return null
          try {
            const url = await getPhotoDownloadUrl(place.imageKey)
            return [place.key, url] as const
          } catch {
            return null
          }
        })
      )
      if (!cancelled) {
        setPhotoUrls(Object.fromEntries(entries.filter(Boolean) as (readonly [string, string])[]))
      }
    }
    void loadPhotos()
    return () => {
      cancelled = true
    }
  }, [savedPlaces])

  const storedPwid = userData as unknown as PWIDUser | null
  const firstName = storedPwid?.name?.trim().split(/\s+/)[0] || ''
  const caregiverPhone = caregiver.phone || storedPwid?.caregiverPhone || ''

  const openHelpCard = useCallback(() => {
    const params = new URLSearchParams({
      destination: activeTrip?.destination || savedPlaces[0]?.locationName || 'Home',
      location: activeTrip
        ? activeTrip.stage === 'waiting'
          ? 'the bus stop'
          : 'the way to your destination'
        : ''
    })
    router.navigate(`/help-card?${params.toString()}`)
  }, [activeTrip, router, savedPlaces])

  const openPlace = useCallback(
    (place: HomePlace) => {
      if (place.journeyId) {
        const params = new URLSearchParams({
          journeyId: place.journeyId,
          destinationName: place.locationName,
          practice: '0'
        })
        if (place.latlng) {
          params.set('lat', String(place.latlng.latitude))
          params.set('lng', String(place.latlng.longitude))
        }
        router.navigate(`/trip?${params.toString()}`)
        return
      }
      if (place.latlng) {
        const params = new URLSearchParams({
          lat: String(place.latlng.latitude),
          lng: String(place.latlng.longitude),
          name: place.locationName,
          description: place.address || place.locationName
        })
        router.navigate(`/transit-options?${params.toString()}`)
        return
      }
      showToast('Ask your caregiver to add directions for this place.')
    },
    [router, showToast]
  )

  const openActiveTrip = useCallback(() => {
    if (!activeTrip?.journeyId) {
      showToast('This trip needs a caregiver setup.')
      return
    }
    const params = new URLSearchParams({
      journeyId: activeTrip.journeyId,
      destinationName: activeTrip.destination,
      practice: '0'
    })
    if (activeTrip.destinationLatLng) {
      params.set('lat', String(activeTrip.destinationLatLng.lat))
      params.set('lng', String(activeTrip.destinationLatLng.lng))
    }
    router.navigate(`/trip?${params.toString()}`)
  }, [activeTrip, router, showToast])

  const call = useCallback(async () => {
    if (!caregiverPhone) {
      showToast('No caregiver number saved.')
      return
    }
    await callCaregiver()
  }, [callCaregiver, caregiverPhone, showToast])

  if (loading) {
    return (
      <AppFrame>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 440 }}>
          <Text style={{ color: colors.muted, fontSize: scale(16) }}>Loading EasyBoard…</Text>
        </View>
      </AppFrame>
    )
  }

  const twoColumn = isWide && Boolean(activeTrip)

  return (
    <AppFrame
      statusLabel={
        preferences.privacyMode === 'paused' ? 'Paused' : isLocationSharing ? 'Sharing this trip' : 'Sharing off'
      }
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <View style={{ flexDirection: twoColumn ? 'row' : 'column', gap: space.lg, alignItems: 'stretch' }}>
        <View
          style={{
            flex: twoColumn ? 1.55 : undefined,
            gap: space.lg,
            minWidth: 0,
            width: twoColumn ? undefined : '100%',
            maxWidth: twoColumn ? undefined : 720,
            marginHorizontal: 'auto'
          }}
        >
          <View style={{ gap: 8 }}>
            <Text
              style={{
                fontFamily: font.display,
                fontSize: scale(isWide ? 48 : 36),
                lineHeight: scale(isWide ? 52 : 40),
                fontWeight: '400',
                letterSpacing: -0.6,
                color: colors.ink
              }}
            >
              {firstName ? `Hello, ${firstName}.` : 'Hello.'}
            </Text>
            <Text
              style={{
                maxWidth: 560,
                fontSize: scale(18),
                lineHeight: bodyLine(18),
                color: colors.muted
              }}
            >
              Where do you want to go?
            </Text>
          </View>

          <View style={{ gap: 10 }}>
            {savedPlaces.length > 0 ? (
              savedPlaces.map(place => (
                <PlaceCard
                  key={place.key}
                  title={place.locationName}
                  address={place.address}
                  imageUrl={photoUrls[place.key]}
                  icon={place.icon}
                  badge={place.journeyId ? 'Guided' : undefined}
                  onPress={() => openPlace(place)}
                />
              ))
            ) : (
              <View
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: colors.line,
                  padding: 20,
                  gap: 8
                }}
              >
                <Text style={{ fontSize: scale(17), fontWeight: '700', color: colors.ink }}>
                  No places saved yet
                </Text>
                <Text style={{ fontSize: scale(15), lineHeight: bodyLine(15), color: colors.muted }}>
                  Ask your caregiver to add Home, School, or Work.
                </Text>
              </View>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <ActionButton
              label='Another place'
              icon='search-outline'
              variant='secondary'
              onPress={() => router.navigate('/place-search')}
            />
            <ActionButton
              label='Call caregiver'
              icon='call-outline'
              variant='secondary'
              onPress={call}
            />
          </View>

          <ActionButton
            label='I need help'
            icon='help-circle-outline'
            variant='secondary'
            onPress={openHelpCard}
            fullWidth
            accessibilityHint='Opens your help card'
          />

          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: radius.lg,
              paddingHorizontal: 18
            }}
          >
            <Toggle
              checked={preferences.privacyMode === 'always'}
              onChange={value => updatePreferences({ privacyMode: value ? 'always' : 'trip-only' })}
              label='Always share my location'
              description='Off means sharing only during a trip.'
            />
          </View>
        </View>

        {activeTrip ? (
          <View style={{ flex: isWide ? 1 : undefined, gap: 14, minWidth: 0 }}>
            <RailCard>
              <Text style={eyebrowStyle(scale)}>Today</Text>
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />
                  <Text style={{ fontSize: scale(13), fontWeight: '700', color: colors.brand }}>
                    {stageLabel(activeTrip.stage)}
                  </Text>
                </View>
                <Text style={{ fontSize: scale(21), fontWeight: '800', lineHeight: scale(26), color: colors.ink }}>
                  {activeTrip.destination}
                </Text>
                <Text style={{ fontSize: scale(14), lineHeight: bodyLine(14), color: colors.muted }}>
                  Updated {new Date(activeTrip.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <ActionButton
                  label='Open trip'
                  icon='arrow-forward'
                  variant='secondary'
                  onPress={openActiveTrip}
                />
              </View>
            </RailCard>
          </View>
        ) : null}
      </View>
      <Toast message={message} />
    </AppFrame>
  )
}

function RailCard({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.lg,
        padding: 18,
        gap: 10,
        boxShadow: shadow.card
      }}
    >
      {children}
    </View>
  )
}

const eyebrowStyle = (scale: (n: number) => number) => ({
  fontSize: scale(12),
  fontWeight: '800' as const,
  letterSpacing: 0.7,
  textTransform: 'uppercase' as const,
  color: colors.muted
})
