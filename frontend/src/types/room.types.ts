export interface RoomMember {
  _id: string;
  name: string;
  email: string;
}

export interface Room {
  _id: string;
  roomId: string;
  name: string;
  access: 'public' | 'private';
  owner: RoomMember;
  members: RoomMember[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoomPayload {
  name: string;
  access?: 'public' | 'private';
  roomId?: string;
}

export interface JoinRoomResult {
  room: Room;
  alreadyMember: boolean;
}
