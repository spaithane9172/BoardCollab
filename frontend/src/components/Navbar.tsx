import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../store/store';
import { logout } from '../store/auth.slice';

export const Navbar: React.FC = () => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAppSelector((state) => state.auth);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <header className="navbar">
      <div className="container">
        <div className="navbar-inner">
          <Link to={isAuthenticated ? '/dashboard' : '/login'} className="brand-logo" aria-label="BoardCollab Home">
            <div className="brand-icon">B</div>
            <span>BoardCollab</span>
          </Link>

          <nav className="nav-links">
            {isAuthenticated ? (
              <>
                <Link to="/dashboard" className="btn btn-outline btn-sm">
                  Dashboard
                </Link>
                <div className="user-badge" title={user?.email}>
                  <div className="user-avatar">{initial}</div>
                  <span>{user?.name}</span>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn btn-secondary btn-sm"
                  aria-label="Log out of your account"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="btn btn-outline btn-sm">
                  Sign In
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm">
                  Create Account
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
};
