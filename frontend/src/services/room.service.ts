import { apiClient } from './api.client.ts';
import type { Room, CreateRoomPayload } from '../types/room.types.ts';

export const roomService = {
  /**
   * Retrieve all rooms the authenticated user owns or is a member of.
   */
  async getUserRooms(): Promise<Room[]> {
    const res = await apiClient.get<Room[]>('/api/rooms');
    return res.data || [];
  },

  /**
   * Create a new room with an authoritative owner assigned by the backend.
   */
  async createRoom(payload: CreateRoomPayload): Promise<Room> {
    const res = await apiClient.post<Room>('/api/rooms', payload);
    if (!res.data) {
      throw new Error(res.message || 'Failed to create room');
    }
    return res.data;
  },

  /**
   * Retrieve a room by its canonical roomId or MongoDB _id.
   * Enforces backend authorization checks.
   */
  async getRoom(identifier: string): Promise<Room> {
    const res = await apiClient.get<Room>(`/api/rooms/${encodeURIComponent(identifier)}`);
    if (!res.data) {
      throw new Error(res.message || 'Room not found');
    }
    return res.data;
  },

  /**
   * Explicitly join a public room as an authenticated member.
   */
  async joinPublicRoom(identifier: string): Promise<Room> {
    const res = await apiClient.post<Room>(`/api/rooms/${encodeURIComponent(identifier)}/join`);
    if (!res.data) {
      throw new Error(res.message || 'Failed to join room');
    }
    return res.data;
  },

  /**
   * Add a registered collaborator to a private room by email (owner only).
   */
  async addMember(identifier: string, email: string): Promise<Room> {
    const res = await apiClient.post<Room>(`/api/rooms/${encodeURIComponent(identifier)}/members`, {
      email: email.trim().toLowerCase()
    });
    if (!res.data) {
      throw new Error(res.message || 'Failed to add collaborator');
    }
    return res.data;
  },

  /**
   * Export room canvas as a binary PNG Blob from the backend.
   * Enforces HTTP status checks so error JSON responses are never returned as image blobs.
   */
  async exportRoomCanvasBlob(
    identifier: string,
    options?: { backgroundColor?: string; padding?: number; allowEmpty?: boolean }
  ): Promise<Blob> {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('boardcollab_token') : null;
    const API_BASE_URL = ((typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || 'http://localhost:5000').replace(/\/+$/, '');
    const url = `${API_BASE_URL}/api/rooms/${encodeURIComponent(identifier)}/export`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(options || {})
    });

    if (!response.ok) {
      let errorMessage = `Server export failed with status ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson && errorJson.message) {
          errorMessage = errorJson.message;
        }
      } catch {
        // Body was not JSON
      }
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('image/png')) {
      throw new Error(`Invalid response format: expected image/png, got ${contentType}`);
    }

    const rawBlob = await response.blob();
    return rawBlob.type === 'image/png' ? rawBlob : new Blob([rawBlob], { type: 'image/png' });
  }
};
