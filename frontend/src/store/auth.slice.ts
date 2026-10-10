import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { authService } from '../services/auth.service';
import { socketService } from '../services/socket.service';
import type { User, LoginCredentials, RegisterCredentials, AuthResponseData } from '../types/auth.types';

const TOKEN_KEY = 'boardcollab_token';
const USER_KEY = 'boardcollab_user';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isRestoring: boolean;
  error: string | null;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  isRestoring: true,
  error: null
};

export const loginUser = createAsyncThunk<
  AuthResponseData,
  LoginCredentials,
  { rejectValue: string }
>('auth/loginUser', async (credentials, { rejectWithValue }) => {
  try {
    const data = await authService.login(credentials);
    return data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return rejectWithValue(message);
  }
});

export const registerUser = createAsyncThunk<
  AuthResponseData,
  RegisterCredentials,
  { rejectValue: string }
>('auth/registerUser', async (credentials, { rejectWithValue }) => {
  try {
    const data = await authService.register(credentials);
    return data;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    return rejectWithValue(message);
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    restoreAuth(state) {
      try {
        const storedToken = localStorage.getItem(TOKEN_KEY);
        const storedUserJson = localStorage.getItem(USER_KEY);

        if (storedToken && storedUserJson) {
          const user = JSON.parse(storedUserJson) as User;
          state.token = storedToken;
          state.user = user;
          state.isAuthenticated = true;
          // Eagerly connect socket if token is available
          socketService.connect(storedToken);
        } else {
          state.token = null;
          state.user = null;
          state.isAuthenticated = false;
        }
      } catch {
        state.token = null;
        state.user = null;
        state.isAuthenticated = false;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } finally {
        state.isRestoring = false;
      }
    },
    logout(state) {
      state.user = null;
      state.token = null;
      state.isAuthenticated = false;
      state.error = null;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      socketService.disconnect();
    },
    clearError(state) {
      state.error = null;
    }
  },
  extraReducers: (builder) => {
    // Login
    builder.addCase(loginUser.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(loginUser.fulfilled, (state, action: PayloadAction<AuthResponseData>) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.error = null;
      localStorage.setItem(TOKEN_KEY, action.payload.token);
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload.user));
      socketService.connect(action.payload.token);
    });
    builder.addCase(loginUser.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Login failed';
    });

    // Register
    builder.addCase(registerUser.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(registerUser.fulfilled, (state, action: PayloadAction<AuthResponseData>) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.isAuthenticated = true;
      state.error = null;
      localStorage.setItem(TOKEN_KEY, action.payload.token);
      localStorage.setItem(USER_KEY, JSON.stringify(action.payload.user));
      socketService.connect(action.payload.token);
    });
    builder.addCase(registerUser.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Registration failed';
    });
  }
});

export const { restoreAuth, logout, clearError } = authSlice.actions;
export default authSlice.reducer;
