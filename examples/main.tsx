import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeToggleDemo } from './theme-toggle-demo.js';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <ThemeToggleDemo />
  </StrictMode>,
);
