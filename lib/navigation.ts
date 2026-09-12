export type NavigationDestination = {
  address: string;
  city: string;
  latitude?: number;
  longitude?: number;
};

/** Build external directions only; geocoding and access checks belong to the API. */
export function navigationLinks(destination: NavigationDestination) {
  const {latitude, longitude} = destination;
  const usesCoordinates = typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const address = destination.address.trim();
  if (!usesCoordinates && !address) return null;
  const target = usesCoordinates ? `${latitude},${longitude}` : [address, destination.city.trim(), 'Guyane française'].filter(Boolean).join(', ');
  const google = new URL('https://www.google.com/maps/dir/');
  google.search = new URLSearchParams({api: '1', destination: target, travelmode: 'driving', dir_action: 'navigate'}).toString();
  const waze = new URL('https://waze.com/ul');
  waze.search = new URLSearchParams({[usesCoordinates ? 'll' : 'q']: target, navigate: 'yes'}).toString();
  const apple = new URL('https://maps.apple.com/');
  apple.search = new URLSearchParams({daddr: target, dirflg: 'd'}).toString();
  return {googleMaps: google.toString(), waze: waze.toString(), appleMaps: apple.toString(), usesCoordinates};
}
