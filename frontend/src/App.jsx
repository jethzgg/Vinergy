import StationFinder from './StationFinder.jsx'
import OpNaviStationMap from './OpNaviStationMap.jsx'
import { getStationDetail, searchStations } from './lib/stationsApi.js'

export default function App() {
  return <StationFinder MapView={OpNaviStationMap} searchStations={searchStations} getStationDetail={getStationDetail} />
}
