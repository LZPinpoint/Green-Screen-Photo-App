import React from 'react'
import { createRoot } from 'react-dom/client'
import { installMock } from './mock'
import AdminApp from '../AdminApp'
installMock()
createRoot(document.getElementById('root')!).render(<AdminApp onExit={() => console.log('exit')} />)
