const CanvasElement = require('../models/canvasElement.model');
const ElementTombstone = require('../models/elementTombstone.model');
const Room = require('../models/room.model');
const { validateNewElement, validateElementUpdate } = require('../utils/canvas.validator');

/**
 * MongoDB-backed persistent canvas state service with CRDT Last-Write-Wins (LWW) conflict resolution.
 * - Tracks logical-clock metadata per mutable property with deterministic client-ID tie-breakers.
 * - Independent property updates merge without overwriting one another.
 * - Conflicting writes to the same property converge deterministically.
 * - Deletions create tombstones to prevent late updates from resurrecting deleted elements.
 * - Clear-canvas uses room clearEpochs to prevent delayed operations from resurrecting old canvases.
 */
class CanvasService {
  /**
   * Retrieves all active canvas elements for a specific room sorted by creation time.
   * @param {string} roomId
   * @returns {Promise<Array<object>>}
   */
  async getElements(roomId) {
    if (!roomId) {
      return [];
    }

    const docs = await CanvasElement.find({ roomId }).sort({ createdAt: 1 });
    return docs.map((doc) => doc.toJSON());
  }

  /**
   * Adds a newly drawn element to the database for the given room.
   * Idempotent: replaying the same operation returns the existing element.
   * @param {string} roomId
   * @param {object} rawElement
   * @param {string} userId
   * @param {object} [metadata]
   * @returns {Promise<object>} created authoritative element
   */
  async addElement(roomId, rawElement, userId, metadata = {}) {
    if (!roomId) {
      throw new Error('Room ID is required');
    }

    const validated = validateNewElement(rawElement);
    const elementId = validated.id;

    // Concurrently verify room clearEpoch and tombstone
    const [room, tombstone] = await Promise.all([
      Room.findOne({ roomId }).select('clearEpoch').lean(),
      ElementTombstone.findOne({ roomId, elementId }).lean()
    ]);

    const currentClearEpoch = room ? room.clearEpoch || 0 : 0;
    if (rawElement.clearEpoch !== undefined && rawElement.clearEpoch < currentClearEpoch) {
      const error = new Error('Operation dropped: room has been cleared');
      error.statusCode = 410;
      throw error;
    }

    // Check if element was previously tombstoned
    if (tombstone) {
      if (rawElement.restore === true || metadata.restore === true) {
        // Explicit restoration: remove tombstone
        await ElementTombstone.deleteOne({ roomId, elementId });
      } else {
        const error = new Error(`Element with ID "${elementId}" was deleted`);
        error.statusCode = 410;
        throw error;
      }
    }

    // Initialize per-property logical clock metadata
    const propertyClocks = {};
    for (const key of Object.keys(validated)) {
      if (key !== 'id' && key !== 'type') {
        propertyClocks[key] = {
          clock: 1,
          updatedBy: userId.toString()
        };
      }
    }

    try {
      // Direct insertion relying on compound unique index { roomId: 1, elementId: 1 }
      const doc = await CanvasElement.create({
        roomId,
        elementId,
        ...validated,
        createdBy: userId.toString(),
        version: 1,
        clearEpoch: currentClearEpoch,
        propertyClocks
      });

      return doc.toJSON();
    } catch (err) {
      if (err.code === 11000) {
        if (
          rawElement.idempotent === true ||
          metadata.idempotent === true ||
          rawElement.restore === true ||
          metadata.restore === true
        ) {
          const existingDoc = await CanvasElement.findOne({ roomId, elementId });
          if (existingDoc) {
            return existingDoc.toJSON();
          }
        }
        const error = new Error(`Element with ID "${elementId}" already exists`);
        error.statusCode = 409;
        throw error;
      }
      throw err;
    }
  }

  /**
   * Updates an existing element using deterministic Last-Write-Wins (LWW) CRDT merge.
   * - Independent properties merge without loss.
   * - Conflicting writes to the same property resolve deterministically via (clock, userId).
   * - Deletions prevent late updates from resurrecting elements.
   * @param {string} roomId
   * @param {string} elementId
   * @param {object} changes
   * @param {string} userId
   * @param {number|object} [expectedVersionOrMetadata]
   * @returns {Promise<object>} updated authoritative element
   */
  async updateElement(roomId, elementId, changes, userId, expectedVersionOrMetadata) {
    if (!roomId || !elementId) {
      throw new Error('Room ID and Element ID are required');
    }

    const clientMetadata =
      typeof expectedVersionOrMetadata === 'object' && expectedVersionOrMetadata !== null
        ? expectedVersionOrMetadata
        : { expectedVersion: expectedVersionOrMetadata };

    const targetExpectedVersion =
      clientMetadata.expectedVersion !== undefined
        ? clientMetadata.expectedVersion
        : (changes && changes.expectedVersion !== undefined ? changes.expectedVersion : undefined);

    // Concurrently fetch tombstone, existing element, and room clearEpoch
    const [tombstone, existing, room] = await Promise.all([
      ElementTombstone.findOne({ roomId, elementId }),
      CanvasElement.findOne({ roomId, elementId }),
      Room.findOne({ roomId }).select('clearEpoch').lean()
    ]);

    // 1. Check if element has been deleted (tombstone)
    if (tombstone) {
      if (changes.restore === true || clientMetadata.restore === true) {
        await ElementTombstone.deleteOne({ roomId, elementId });
      } else {
        const error = new Error(`Cannot update element "${elementId}": element has been deleted`);
        error.statusCode = 404;
        throw error;
      }
    }

    // 2. Retrieve existing element
    if (!existing) {
      const error = new Error(`Element with ID "${elementId}" not found in room`);
      error.statusCode = 404;
      throw error;
    }

    // 3. Check room clearEpoch
    const currentClearEpoch = room ? room.clearEpoch || 0 : 0;
    if (clientMetadata.clearEpoch !== undefined && clientMetadata.clearEpoch < currentClearEpoch) {
      const error = new Error('Operation dropped: room has been cleared');
      error.statusCode = 410;
      throw error;
    }

    // Fast-fail if expectedVersion is wildly out-of-range (e.g. from the future)
    if (targetExpectedVersion !== undefined && targetExpectedVersion > existing.version + 5) {
      const error = new Error(`Version conflict: element is at version ${existing.version}, expected ${targetExpectedVersion}`);
      error.statusCode = 409;
      error.currentVersion = existing.version;
      error.expectedVersion = targetExpectedVersion;
      throw error;
    }

    const existingData = existing.toJSON();
    const validatedChanges = validateElementUpdate(changes, existingData);

    // 4. Deterministic Per-Property CRDT LWW Merge
    const existingClocks = existing.propertyClocks || {};
    let maxClock = existing.version || 1;
    const incomingUser = userId.toString();

    for (const [prop, val] of Object.entries(validatedChanges)) {
      const currentMeta = existingClocks[prop] || {
        clock: existing.version || 1,
        updatedBy: existing.updatedBy || existing.createdBy || ''
      };
      const currentClock = Number(currentMeta.clock || 1);
      const currentUser = (currentMeta.updatedBy || '').toString();

      // Determine incoming clock for this property
      let incomingClock;
      if (clientMetadata.propertyClocks && clientMetadata.propertyClocks[prop]?.clock) {
        incomingClock = Number(clientMetadata.propertyClocks[prop].clock);
      } else if (clientMetadata.clock !== undefined) {
        incomingClock = Number(clientMetadata.clock);
      } else if (targetExpectedVersion !== undefined && targetExpectedVersion === existing.version) {
        incomingClock = existing.version + 1;
      } else if (targetExpectedVersion !== undefined) {
        incomingClock = targetExpectedVersion + 1;
      } else {
        incomingClock = currentClock + 1;
      }

      // LWW Deterministic Comparison Rule:
      // (incomingClock, incomingUser) > (currentClock, currentUser)
      let incomingWins = false;
      if (incomingClock > currentClock) {
        incomingWins = true;
      } else if (incomingClock === currentClock) {
        incomingWins = incomingUser >= currentUser;
      } else {
        incomingWins = false;
      }

      if (incomingWins) {
        existing[prop] = val;
        existingClocks[prop] = {
          clock: incomingClock,
          updatedBy: incomingUser
        };
        if (incomingClock > maxClock) {
          maxClock = incomingClock;
        }
      }
    }

    // Authoritative version increments monotonically
    existing.version = Math.max((existing.version || 1) + 1, maxClock);
    existing.updatedBy = incomingUser;
    existing.propertyClocks = existingClocks;
    existing.markModified('propertyClocks');

    await existing.save();
    return existing.toJSON();
  }

  /**
   * Deletes an element from the database and records a tombstone.
   * @param {string} roomId
   * @param {string} elementId
   * @param {string} [userId]
   * @returns {Promise<{ id: string, elementId: string }>}
   */
  async deleteElement(roomId, elementId, userId = 'system') {
    if (!roomId || !elementId) {
      throw new Error('Room ID and Element ID are required');
    }

    const [existing, room] = await Promise.all([
      CanvasElement.findOne({ roomId, elementId }),
      Room.findOne({ roomId }).select('clearEpoch').lean()
    ]);

    if (!existing) {
      const error = new Error(`Element with ID "${elementId}" not found in room`);
      error.statusCode = 404;
      throw error;
    }

    const deleteClock = (existing.version || 1) + 1;

    // Record tombstone and delete element concurrently
    await Promise.all([
      ElementTombstone.findOneAndUpdate(
        { roomId, elementId },
        {
          $set: {
            deletedAt: new Date(),
            deletedBy: userId.toString(),
            deleteClock,
            clearEpoch: room ? room.clearEpoch || 0 : 0
          }
        },
        { upsert: true }
      ),
      CanvasElement.findOneAndDelete({ roomId, elementId })
    ]);

    return {
      id: elementId,
      elementId
    };
  }

  /**
   * Clears all elements for a room or all rooms, bumping clearEpoch.
   * @param {string} [roomId]
   * @param {string} [userId]
   * @returns {Promise<any>}
   */
  async clear(roomId, userId = 'system') {
    if (roomId) {
      // Bump room clearEpoch to invalidate delayed operations
      await Room.findOneAndUpdate(
        { roomId },
        { $inc: { clearEpoch: 1 }, $set: { clearedAt: new Date() } }
      );
      // Clean elements and tombstones for this room concurrently
      await Promise.all([
        CanvasElement.deleteMany({ roomId }),
        ElementTombstone.deleteMany({ roomId })
      ]);
      return { roomId };
    }

    // Global clear (typically in test hooks)
    await Promise.all([
      CanvasElement.deleteMany({}),
      ElementTombstone.deleteMany({})
    ]);
  }
}

module.exports = new CanvasService();
