// The browser's location, with plain-language errors. Needs https (or localhost) and the person's permission.
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser cannot share your location. Please use a current version of Chrome, Edge, Safari or Firefox.'))
    if (window.isSecureContext === false) return reject(new Error('Location only works on a secure (https) page.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(
        e.code === 1 ? 'Location access is blocked. Click the padlock next to the address, allow Location, then try again.'
          : e.code === 3 ? 'Finding your location took too long. Move near a window or turn on GPS, then try again.'
            : 'Your location could not be found. Turn on GPS or Wi-Fi, then try again.',
      )),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    )
  })
}
