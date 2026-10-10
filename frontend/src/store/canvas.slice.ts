import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { CanvasElement } from '../types/canvas.types';

export interface CanvasState {
  elements: CanvasElement[];
}

const initialState: CanvasState = {
  elements: []
};

export const canvasSlice = createSlice({
  name: 'canvas',
  initialState,
  reducers: {
    setElements: (state, action: PayloadAction<CanvasElement[]>) => {
      state.elements = action.payload.filter((e) => !e.isDeleted);
    },
    addElement: (state, action: PayloadAction<CanvasElement>) => {
      if (action.payload.isDeleted) {
        state.elements = state.elements.filter((e) => e.id !== action.payload.id);
        return;
      }
      const index = state.elements.findIndex((e) => e.id === action.payload.id);
      if (index >= 0) {
        state.elements[index] = action.payload;
      } else {
        state.elements.push(action.payload);
      }
    },
    updateElement: (state, action: PayloadAction<CanvasElement>) => {
      if (action.payload.isDeleted) {
        state.elements = state.elements.filter((e) => e.id !== action.payload.id);
        return;
      }
      const index = state.elements.findIndex((e) => e.id === action.payload.id);
      if (index >= 0) {
        state.elements[index] = action.payload;
      } else {
        state.elements.push(action.payload);
      }
    },
    deleteElement: (state, action: PayloadAction<string>) => {
      state.elements = state.elements.filter((e) => e.id !== action.payload);
    },
    clearCanvas: (state) => {
      state.elements = [];
    }
  }
});

export const {
  setElements,
  addElement,
  updateElement,
  deleteElement,
  clearCanvas
} = canvasSlice.actions;

export default canvasSlice.reducer;
