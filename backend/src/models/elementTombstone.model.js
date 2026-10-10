const mongoose = require('mongoose');

const elementTombstoneSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: [true, 'Room ID is required'],
      index: true
    },
    elementId: {
      type: String,
      required: [true, 'Element ID is required']
    },
    deletedAt: {
      type: Date,
      default: Date.now
    },
    deletedBy: {
      type: String,
      required: true
    },
    deleteClock: {
      type: Number,
      default: 1
    },
    clearEpoch: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true
  }
);

elementTombstoneSchema.index({ roomId: 1, elementId: 1 }, { unique: true });

const ElementTombstone = mongoose.model('ElementTombstone', elementTombstoneSchema);

module.exports = ElementTombstone;
