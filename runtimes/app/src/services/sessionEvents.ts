type Listener = () => void

const listeners = new Set<Listener>()

/** Notify providers that the signed-in user changed or was cleared. */
export function notifySessionChanged() {
  listeners.forEach(listener => listener())
}

export function subscribeSessionChanged(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
