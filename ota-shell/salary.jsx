import React from 'react';
import { createRoot } from 'react-dom/client';
import OtSalary from '../src/components/OtSalary/OtSalary.jsx';
import { MobileOtErrorBoundary } from '../src/components/AndroidLauncher.jsx';
import './shell.css';

window.__UDHAAR_ONLY_APK__ = false;
window.workspaceSection = 'today';
document.title = 'Time Is Money';

createRoot(document.getElementById('root')).render(
  <MobileOtErrorBoundary><OtSalary standaloneMobile /></MobileOtErrorBoundary>
);
