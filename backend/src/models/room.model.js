const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: [true, 'Room ID is required'],
      unique: true,
      trim: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Room name is required'],
      trim: true,
      minlength: [1, 'Room name cannot be empty'],
      maxlength: [100, 'Room name cannot exceed 100 characters']
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Room owner is required'],
      index: true
    },
    access: {
      type: String,
      enum: {
        values: ['public', 'private'],
        message: 'Access must be either public or private'
      },
      default: 'public',
      index: true
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    clearEpoch: {
      type: Number,
      default: 0
    },
    clearedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.__v;
        return ret;
      }
    }
  }
);

roomSchema.index({ members: 1 });

/**
 * Checks if a given userId is authorized to access this room.
 * @param {string|null} userId - The ID of the requesting user (or null/undefined if unauthenticated)
 * @returns {{ authorized: boolean, reason?: string, statusCode?: number }}
 */
roomSchema.methods.checkAccess = function (userId) {
  if (this.access === 'public') {
    return { authorized: true };
  }

  // Room is private
  if (!userId) {
    return {
      authorized: false,
      reason: 'Authentication required to access this private room',
      statusCode: 401
    };
  }

  const userIdStr = userId.toString();
  const ownerIdStr = this.owner._id ? this.owner._id.toString() : this.owner.toString();

  if (ownerIdStr === userIdStr) {
    return { authorized: true };
  }

  const isMember = this.members && this.members.some(member => {
    const memberIdStr = member._id ? member._id.toString() : member.toString();
    return memberIdStr === userIdStr;
  });

  if (isMember) {
    return { authorized: true };
  }

  return {
    authorized: false,
    reason: 'Access denied: you are not a member of this private room',
    statusCode: 403
  };
};

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;
