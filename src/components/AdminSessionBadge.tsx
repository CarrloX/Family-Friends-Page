import React from 'react';
import { motion } from 'framer-motion';
import type { AdminAccessState } from '../services/accessControl';

export interface AdminSessionBadgeProps {
  adminAccess: AdminAccessState;
  onLogout: () => void;
}

export const AdminSessionBadge: React.FC<AdminSessionBadgeProps> = ({ adminAccess, onLogout }) => {
  if (!adminAccess.isAuthenticated) return null;

  return (
    <motion.div
      className="admin-session-badge"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        position: 'fixed',
        top: 14,
        left: 14,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(23, 26, 33, 0.94)',
        border: adminAccess.isAdmin
          ? '1px solid rgba(168, 85, 247, 0.5)'
          : '1px solid rgba(156, 163, 175, 0.3)',
        boxShadow: adminAccess.isAdmin
          ? '0 0 15px rgba(168, 85, 247, 0.25)'
          : 'none',
        borderRadius: 20,
        padding: '6px 12px',
        fontSize: '12px',
        color: adminAccess.isAdmin ? '#c084fc' : '#9ca3af',
        backdropFilter: 'blur(8px)',
      }}
    >
      <span>
        {adminAccess.isAdmin ? '🛡️ Admin' : '👤 Usuario'}: {adminAccess.adminEmail || 'Sesión activa'}
      </span>
      <button
        type="button"
        onClick={onLogout}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#f87171',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: 4,
        }}
        title="Cerrar sesión (Volver a solo lectura)"
      >
        Cerrar sesión
      </button>
    </motion.div>
  );
};

export default AdminSessionBadge;
