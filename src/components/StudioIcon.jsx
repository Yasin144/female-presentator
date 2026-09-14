import React from 'react';

const paths = {
  presentator: <><rect x="3" y="3" width="18" height="13" rx="1.5"/><path d="M8 21l4-5 4 5M7 7h10M7 11h6"/></>,
  quotes: <><path d="M4 5h16v12H9l-5 4V5Z"/><path d="M8 9h3v4H8v-2c0-1 1-2 2-2m4 0h3v4h-3v-2c0-1 1-2 2-2"/></>,
  exporter: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5m8-5v5m-6 3 5 3-5 3v-6Z"/></>,
  resizer: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="7" y="7" width="10" height="10" rx="1"/></>,
  captions: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M10 10H6v4h4m8-4h-4v4h4"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  music: <><path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/></>,
  audio: <><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 3 7 3 7H3s3-1 3-7Zm4 11h4"/></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 1.5-2.5 3M12 17h.01"/></>,
};

export default function StudioIcon({ name, size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] || paths.presentator}</svg>;
}
