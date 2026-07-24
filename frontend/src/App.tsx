import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { ConversionScreen } from '@/components/conversion-screen'
import { HomeScreen } from '@/components/home-screen'
import { ProjectScreen } from '@/components/project-screen'
import { Toaster } from '@/components/ui/sonner'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeScreen />} />
        <Route path="/projects/:id" element={<ProjectScreen />} />
        <Route path="/conversions/:id" element={<ConversionScreen />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}

export default App
