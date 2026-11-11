// Self-hosted fonts (SPEC §15), bundled from npm rather than loaded from a font CDN.
// Roboto covers Latin (incl. Vietnamese and Pacific diacritics), Greek and Cyrillic.
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/700.css';
import '@fontsource/roboto-mono/500.css';
import './styles/tokens.css';
import './styles/app.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyTheme, store } from './session';

applyTheme(store.theme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
