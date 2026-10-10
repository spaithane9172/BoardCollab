import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import authReducer from './auth.slice';
import roomReducer from './room.slice';
import canvasReducer from './canvas.slice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    rooms: roomReducer,
    canvas: canvasReducer
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
