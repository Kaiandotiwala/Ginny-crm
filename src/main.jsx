import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './components/AuthGate'
import App from './components/App'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </React.StrictMode>
)
