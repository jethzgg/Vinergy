import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">Vinergy — Tìm trạm</h1>
        <p className="mt-2 text-slate-400">Khởi tạo giao diện nguyên mẫu tìm kiếm trạm (WBS 1.2.1 / 1.2.2)</p>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
