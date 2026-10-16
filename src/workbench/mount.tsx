/** @jsxImportSource react */
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { initializeWorkbench } from './store'

import './styles.css'

export function mountWorkbench(mode: 'sidepanel' | 'workbench') {
  createRoot(document.getElementById('root')!).render(<App mode={mode} />)
  void initializeWorkbench()
}
