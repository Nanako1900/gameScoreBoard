import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Base styles first: Vite emits CSS in import order, and every component
// stylesheet App pulls in must come later so it can override these rules.
import './theme.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
