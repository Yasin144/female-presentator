import React from 'react';
import { createRoot } from 'react-dom/client';
import OtSalary from '../src/components/OtSalary/OtSalary.jsx';
import UdhaarStandaloneApp from '../src/components/OtSalary/UdhaarStandaloneApp.jsx';
import { MobileOtErrorBoundary } from '../src/components/AndroidLauncher.jsx';
import './shell.css';

const udhaar = Boolean(window.__UDHAAR_ONLY_APK__) || new URLSearchParams(window.location.search).get('app') === 'udhaar';
window.__UDHAAR_ONLY_APK__ = udhaar;
window.workspaceSection = 'today';
document.title = udhaar ? 'Udhaar Book' : 'Time Is Money';
createRoot(document.getElementById('root')).render(
  <MobileOtErrorBoundary>{udhaar ? <UdhaarStandaloneApp /> : <OtSalary standaloneMobile />}</MobileOtErrorBoundary>
);
