import React from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './index.css'
import StationFinder from './StationFinder.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <StationFinder />
  </React.StrictMode>,
)
