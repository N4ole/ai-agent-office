import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initStore } from './store';
import './styles.css';

try {
  if (localStorage.getItem('theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch {
  /* storage unavailable */
}

initStore()
  .catch((e) => console.error('init failed', e))
  .finally(() => createRoot(document.getElementById('root')!).render(<App />));
