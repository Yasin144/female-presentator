import React from 'react';
import { createRoot } from 'react-dom/client';
import UdhaarStandaloneApp from '../src/components/OtSalary/UdhaarStandaloneApp.jsx';
import { MobileOtErrorBoundary } from '../src/components/AndroidLauncher.jsx';
import './shell.css';

window.__UDHAAR_ONLY_APK__ = true;
window.workspaceSection = 'today';
document.title = 'Udhaar Book';

createRoot(document.getElementById('root')).render(
  <MobileOtErrorBoundary><UdhaarStandaloneApp /></MobileOtErrorBoundary>
);
