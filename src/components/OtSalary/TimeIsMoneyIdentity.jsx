import React from 'react';
import { Timer, IndianRupee } from 'lucide-react';
import './UpdateAlerts.css';

export default function TimeIsMoneyIdentity({ size = 44 }) {
  return (
    <span className="time-money-mark" role="img" aria-label="Time Is Money" style={{ width: size, height: size }}>
      <Timer size={Math.round(size * 0.62)} strokeWidth={1.8} aria-hidden="true" />
      <span className="time-money-coin"><IndianRupee size={Math.round(size * 0.27)} strokeWidth={2} aria-hidden="true" /></span>
    </span>
  );
}
