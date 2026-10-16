import React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/devconsole.css'
import App from './App.js'

// 初始化主题：从 localStorage 读取，默认为 dark
const savedTheme = localStorage.getItem('devconsole-theme') || 'dark'
document.documentElement.setAttribute('data-theme', savedTheme)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
