import React from 'react';
import { createRoot } from 'react-dom/client';
import OtSalary from './components/OtSalary/OtSalary.jsx';
import './salary-preview.css';

// The isolated design review never contacts production sync, OTA or messaging services.
const localFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) {
    return Promise.reject(new Error('External services are disabled in this local design review.'));
  }
  return localFetch(input, options);
};

window.workspaceSection = 'today';
createRoot(document.getElementById('root')).render(<OtSalary standaloneMobile />);
