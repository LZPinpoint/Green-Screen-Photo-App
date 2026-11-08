import { createRoot } from 'react-dom/client'
import './theme/imagine.css'
import { installMockBooth } from './mockBooth'
import App from './App'

// Outside Electron (plain browser / public web demo) there is no preload bridge: run on the in-memory mock.
export const DEMO_MODE = installMockBooth()
createRoot(document.getElementById('root')!).render(<App demo={DEMO_MODE} />)
