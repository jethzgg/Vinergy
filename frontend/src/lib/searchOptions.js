import { origins, battery_families } from '../../../data/seed_stations_v0.json'
export const FAMILIES = battery_families
export const FAMILY_CODES = FAMILIES.map((family) => family.family_code)
export const SAMPLE_ORIGINS = [
  { id: 'LOC-01', label: 'LOC-01 · Hai Bà Trưng', ...origins['LOC-01'] },
  { id: 'LOC-02', label: 'LOC-02 · Hoàn Kiếm', ...origins['LOC-02'] },
  { id: 'LOC-03', label: 'LOC-03 · ngoại thành', ...origins['LOC-03'] },
]

export const DEFAULT_FORM = {
  lat: origins['LOC-01'].lat.toFixed(4),
  lng: origins['LOC-01'].lng.toFixed(4),
  service_type: 'SWAPPING',
  family_code: 'FAM_A',
  radius_km: '2',
  only_open: true,
}
