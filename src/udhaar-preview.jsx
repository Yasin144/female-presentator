import React from 'react';
import { createRoot } from 'react-dom/client';
import UdhaarStandaloneApp from './components/OtSalary/UdhaarStandaloneApp.jsx';
import './udhaar-preview.css';

// Design review uses only this origin's empty storage and never reaches production services.
const localFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) {
    return Promise.reject(new Error('External services are disabled in this local design review.'));
  }
  return localFetch(input, options);
};
createRoot(document.getElementById('root')).render(<UdhaarStandaloneApp isLight />);
