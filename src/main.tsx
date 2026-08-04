// First, and deliberately so: this settles which security policy is in force
// and, if need be, sends the browser to the other document before anything else
// is evaluated. `import` declarations are hoisted above every statement, so
// being first in this list is the only way to be first at all — the reasoning
// is in the module itself.
import './ui/app/boot'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/app/App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
