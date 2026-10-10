import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import { roomService } from '../services/room.service';
import type { Room, CreateRoomPayload } from '../types/room.types';

interface RoomState {
  rooms: Room[];
  isLoading: boolean;
  error: string | null;
  isCreating: boolean;
  createError: string | null;
}

const initialState: RoomState = {
  rooms: [],
  isLoading: false,
  error: null,
  isCreating: false,
  createError: null
};

export const fetchRooms = createAsyncThunk<Room[], void, { rejectValue: string }>(
  'rooms/fetchRooms',
  async (_, { rejectWithValue }) => {
    try {
      return await roomService.getUserRooms();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to fetch rooms';
      return rejectWithValue(message);
    }
  }
);

export const createRoom = createAsyncThunk<Room, CreateRoomPayload, { rejectValue: string }>(
  'rooms/createRoom',
  async (payload, { rejectWithValue }) => {
    try {
      return await roomService.createRoom(payload);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to create room';
      return rejectWithValue(message);
    }
  }
);

export const joinRoom = createAsyncThunk<Room, string, { rejectValue: string }>(
  'rooms/joinRoom',
  async (roomId, { rejectWithValue }) => {
    try {
      return await roomService.joinPublicRoom(roomId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to join room';
      return rejectWithValue(message);
    }
  }
);

const roomSlice = createSlice({
  name: 'rooms',
  initialState,
  reducers: {
    clearRoomError(state) {
      state.error = null;
    },
    clearCreateError(state) {
      state.createError = null;
    },
    addOrUpdateRoom(state, action: PayloadAction<Room>) {
      const index = state.rooms.findIndex((r) => r.roomId === action.payload.roomId);
      if (index >= 0) {
        state.rooms[index] = action.payload;
      } else {
        state.rooms.unshift(action.payload);
      }
    }
  },
  extraReducers: (builder) => {
    // fetchRooms
    builder
      .addCase(fetchRooms.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchRooms.fulfilled, (state, action) => {
        state.isLoading = false;
        state.rooms = action.payload;
      })
      .addCase(fetchRooms.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Failed to load boards';
      });

    // createRoom
    builder
      .addCase(createRoom.pending, (state) => {
        state.isCreating = true;
        state.createError = null;
      })
      .addCase(createRoom.fulfilled, (state, action) => {
        state.isCreating = false;
        // Prepend new room to list
        const exists = state.rooms.some((r) => r.roomId === action.payload.roomId);
        if (!exists) {
          state.rooms.unshift(action.payload);
        }
      })
      .addCase(createRoom.rejected, (state, action) => {
        state.isCreating = false;
        state.createError = action.payload || 'Failed to create board';
      });

    // joinRoom
    builder
      .addCase(joinRoom.fulfilled, (state, action) => {
        const index = state.rooms.findIndex((r) => r.roomId === action.payload.roomId);
        if (index >= 0) {
          state.rooms[index] = action.payload;
        } else {
          state.rooms.unshift(action.payload);
        }
      });
  }
});

export const { clearRoomError, clearCreateError, addOrUpdateRoom } = roomSlice.actions;
export default roomSlice.reducer;
