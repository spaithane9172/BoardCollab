import { describe, it } from 'node:test';
import assert from 'node:assert';
import { roomService } from '../src/services/room.service.ts';
import type { Room } from '../src/types/room.types.ts';

describe('Private Room Invitation & Collaborator Tests', () => {
  describe('1. roomService.addMember API Client Integration', () => {
    it('successfully calls POST /api/rooms/:id/members with trimmed lowercase email', async () => {
      const originalFetch = globalThis.fetch;
      let capturedUrl = '';
      let capturedMethod = '';
      let capturedBody: Record<string, unknown> = {};

      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = init?.method || '';
        capturedBody = JSON.parse(init?.body as string);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: 'success',
            message: 'Member added successfully',
            data: {
              _id: 'room-obj-1',
              roomId: 'room-priv-1',
              name: 'Private Strategy Board',
              access: 'private',
              owner: { _id: 'owner-1', name: 'Alice', email: 'alice@example.com' },
              members: [
                { _id: 'owner-1', name: 'Alice', email: 'alice@example.com' },
                { _id: 'user-2', name: 'Bob', email: 'bob@example.com' }
              ]
            }
          })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        const result = await roomService.addMember('room-priv-1', '  BOB@example.com  ');

        assert.strictEqual(capturedMethod, 'POST');
        assert.ok(capturedUrl.endsWith('/api/rooms/room-priv-1/members'));
        assert.strictEqual(capturedBody.email, 'bob@example.com', 'Email must be trimmed and lowercased');
        assert.strictEqual(result.roomId, 'room-priv-1');
        assert.strictEqual(result.members.length, 2);
        assert.strictEqual(result.members[1].email, 'bob@example.com');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('propagates 404 error when invited email address is not registered', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            status: 'error',
            message: 'User to add not found'
          })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        await assert.rejects(
          async () => {
            await roomService.addMember('room-priv-1', 'nonexistent@example.com');
          },
          (err: Error) => {
            assert.strictEqual(err.message, 'User to add not found');
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('propagates 409 error when invited user is already a member of the room', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            status: 'error',
            message: 'User is already a member of this room'
          })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        await assert.rejects(
          async () => {
            await roomService.addMember('room-priv-1', 'bob@example.com');
          },
          (err: Error) => {
            assert.strictEqual(err.message, 'User is already a member of this room');
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('propagates 403 error when a non-owner attempts to invite collaborators', async () => {
      const originalFetch = globalThis.fetch;

      globalThis.fetch = (async () => {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            status: 'error',
            message: 'Only the room owner can add members to this room'
          })
        } as unknown as Response;
      }) as typeof fetch;

      try {
        await assert.rejects(
          async () => {
            await roomService.addMember('room-priv-1', 'charlie@example.com');
          },
          (err: Error) => {
            assert.strictEqual(err.message, 'Only the room owner can add members to this room');
            return true;
          }
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('2. Ownership Determination & Header Button Visibility Logic', () => {
    const ownerUser = { _id: 'user-alice-1', name: 'Alice', email: 'alice@example.com' };
    const memberUser = { _id: 'user-bob-2', name: 'Bob', email: 'bob@example.com' };

    const privateRoom: Room = {
      _id: 'room-1',
      roomId: 'room-priv-abc',
      name: 'Private Board',
      access: 'private',
      owner: ownerUser,
      members: [ownerUser, memberUser],
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z'
    };

    const publicRoom: Room = {
      _id: 'room-2',
      roomId: 'room-pub-xyz',
      name: 'Public Board',
      access: 'public',
      owner: ownerUser,
      members: [ownerUser],
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z'
    };

    const checkIsOwner = (currentUserId: string | undefined, room: Room | null): boolean => {
      return Boolean(
        currentUserId &&
        room &&
        (typeof room.owner === 'string'
          ? room.owner === currentUserId
          : room.owner?._id === currentUserId)
      );
    };

    const shouldShowInviteButton = (currentUserId: string | undefined, room: Room | null): boolean => {
      return Boolean(room && room.access === 'private' && checkIsOwner(currentUserId, room));
    };

    it('shows Invite Collaborator button ONLY for the owner of a private room', () => {
      // Alice is owner of private room -> MUST show button
      assert.strictEqual(
        shouldShowInviteButton(ownerUser._id, privateRoom),
        true,
        'Owner of private room must see Invite Collaborator button'
      );
    });

    it('hides Invite Collaborator button for non-owner member of private room', () => {
      // Bob is member of private room, but NOT owner -> MUST hide button
      assert.strictEqual(
        shouldShowInviteButton(memberUser._id, privateRoom),
        false,
        'Non-owner member must NOT see Invite Collaborator button'
      );
    });

    it('hides Invite Collaborator button on public rooms even for the owner', () => {
      // Alice owns public room -> MUST hide button (public rooms are open to all)
      assert.strictEqual(
        shouldShowInviteButton(ownerUser._id, publicRoom),
        false,
        'Public room must NOT show Invite Collaborator button'
      );
    });

    it('hides Invite Collaborator button for unauthenticated users', () => {
      assert.strictEqual(
        shouldShowInviteButton(undefined, privateRoom),
        false,
        'Unauthenticated visitor must NOT see Invite Collaborator button'
      );
    });
  });
});
