import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Lobby from './pages/Lobby'
import TableRoom from './pages/TableRoom'
import Debrief from './pages/Debrief'
import Profile from './pages/Profile'
import People from './pages/People'
import Inbox from './pages/Inbox'
import Membership from './pages/Membership'
import Join from './pages/Join'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/join/:code" element={<Join />} />
          <Route path="/join/:code/:mode" element={<Join />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route element={<Layout />}>
            <Route path="/play" element={<Lobby />} />
            <Route path="/t/:id" element={<TableRoom />} />
            <Route path="/debrief/:id" element={<Debrief />} />
            <Route path="/me" element={<Profile />} />
            <Route path="/p/:username" element={<Profile />} />
            <Route path="/people" element={<People />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/membership" element={<Membership />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
