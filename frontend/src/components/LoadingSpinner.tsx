import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message, size = 'md' }) => {
  const spinnerClass = size === 'lg' ? 'spinner spinner-lg' : size === 'sm' ? 'spinner btn-sm' : 'spinner';

  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className={spinnerClass} />
      {message && <p style={{ color: 'var(--text-muted)', fontSize: '0.9375rem' }}>{message}</p>}
    </div>
  );
};
