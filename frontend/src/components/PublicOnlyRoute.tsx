import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '../store/store';
import { LoadingSpinner } from './LoadingSpinner';

export const PublicOnlyRoute: React.FC = () => {
  const { isAuthenticated, isRestoring } = useAppSelector((state) => state.auth);

  if (isRestoring) {
    return <LoadingSpinner message="Loading..." size="lg" />;
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};
