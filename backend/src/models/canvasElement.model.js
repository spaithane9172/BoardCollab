const mongoose = require('mongoose');

const canvasElementSchema = new mongoose.Schema(
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
    type: {
      type: String,
      required: [true, 'Element type is required'],
      enum: {
        values: ['stroke', 'rectangle', 'circle', 'text'],
        message: 'Invalid element type'
      }
    },
    // Position coordinates
    x: { type: Number },
    y: { type: Number },
    // Dimensions
    width: { type: Number },
    height: { type: Number },
    radius: { type: Number },
    // Stroke path points (array of objects or numbers)
    points: { type: mongoose.Schema.Types.Mixed },
    // Text specific fields
    text: { type: String },
    fontSize: { type: Number },
    fontFamily: { type: String },
    // Styling properties
    strokeColor: { type: String },
    fillColor: { type: String },
    strokeWidth: { type: Number },
    opacity: { type: Number },
    // Metadata
    createdBy: {
      type: String,
      required: [true, 'CreatedBy user ID is required']
    },
    version: {
      type: Number,
      required: true,
      default: 1
    },
    updatedBy: {
      type: String
    },
    clearEpoch: {
      type: Number,
      default: 0
    },
    propertyClocks: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        ret.id = ret.elementId;
        delete ret._id;
        delete ret.__v;
        if (ret.createdAt instanceof Date) {
          ret.createdAt = ret.createdAt.toISOString();
        }
        if (ret.updatedAt instanceof Date) {
          ret.updatedAt = ret.updatedAt.toISOString();
        }
        return ret;
      }
    }
  }
);

// Compound unique index ensuring elementId is unique within each room
canvasElementSchema.index({ roomId: 1, elementId: 1 }, { unique: true });
// Index on roomId and createdAt for efficient room retrieval in creation order
canvasElementSchema.index({ roomId: 1, createdAt: 1 });

const CanvasElement = mongoose.model('CanvasElement', canvasElementSchema);

module.exports = CanvasElement;
