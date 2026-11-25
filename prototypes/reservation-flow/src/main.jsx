import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import ReservationApp from './ReservationApp.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ReservationApp />
  </React.StrictMode>,
)
