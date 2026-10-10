import { apiClient } from './api.client';
import type { AuthResponseData, LoginCredentials, RegisterCredentials } from '../types/auth.types';

export const authService = {
  async register(credentials: RegisterCredentials): Promise<AuthResponseData> {
    const res = await apiClient.post<AuthResponseData>('/api/auth/register', credentials);
    if (!res.data) {
      throw new Error(res.message || 'Registration failed');
    }
    return res.data;
  },

  async login(credentials: LoginCredentials): Promise<AuthResponseData> {
    const res = await apiClient.post<AuthResponseData>('/api/auth/login', credentials);
    if (!res.data) {
      throw new Error(res.message || 'Login failed');
    }
    return res.data;
  }
};
