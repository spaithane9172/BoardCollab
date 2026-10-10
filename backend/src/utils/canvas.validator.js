/**
 * Validation rules and limits for canvas elements.
 */

const MAX_POINTS_COUNT = 2000;
const MAX_TEXT_LENGTH = 1000;
const MAX_DIMENSION = 50000;
const MAX_STROKE_WIDTH = 100;
const MAX_FONT_SIZE = 200;
const ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

const isFiniteNumber = (val) => typeof val === 'number' && Number.isFinite(val);

const validateStyling = (styling = {}) => {
  const sanitized = {};

  if (styling.strokeColor !== undefined) {
    if (typeof styling.strokeColor !== 'string' || styling.strokeColor.length > 50) {
      throw new Error('Invalid strokeColor');
    }
    sanitized.strokeColor = styling.strokeColor.trim();
  }

  if (styling.fillColor !== undefined) {
    if (typeof styling.fillColor !== 'string' || styling.fillColor.length > 50) {
      throw new Error('Invalid fillColor');
    }
    sanitized.fillColor = styling.fillColor.trim();
  }

  if (styling.strokeWidth !== undefined) {
    if (!isFiniteNumber(styling.strokeWidth) || styling.strokeWidth < 0 || styling.strokeWidth > MAX_STROKE_WIDTH) {
      throw new Error(`strokeWidth must be a number between 0 and ${MAX_STROKE_WIDTH}`);
    }
    sanitized.strokeWidth = styling.strokeWidth;
  }

  if (styling.opacity !== undefined) {
    if (!isFiniteNumber(styling.opacity) || styling.opacity < 0 || styling.opacity > 1) {
      throw new Error('opacity must be a number between 0 and 1');
    }
    sanitized.opacity = styling.opacity;
  }

  if (styling.fontFamily !== undefined) {
    if (typeof styling.fontFamily !== 'string' || styling.fontFamily.length > 50) {
      throw new Error('Invalid fontFamily');
    }
    sanitized.fontFamily = styling.fontFamily.trim();
  }

  if (styling.fontSize !== undefined) {
    if (!isFiniteNumber(styling.fontSize) || styling.fontSize < 1 || styling.fontSize > MAX_FONT_SIZE) {
      throw new Error(`fontSize must be a number between 1 and ${MAX_FONT_SIZE}`);
    }
    sanitized.fontSize = styling.fontSize;
  }

  return sanitized;
};

/**
 * Validates a new canvas element proposed by a client.
 * @param {object} payload
 * @returns {object} sanitized element data
 */
const validateNewElement = (payload) => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Element payload must be an object');
  }

  const { id, type, ...rest } = payload;

  if (!id || typeof id !== 'string' || !ID_REGEX.test(id)) {
    throw new Error('Element id must be a string (1-64 alphanumeric, underscores or hyphens)');
  }

  if (!type || !['stroke', 'rectangle', 'circle', 'text'].includes(type)) {
    throw new Error('Element type must be one of: stroke, rectangle, circle, text');
  }

  const sanitized = {
    id,
    type,
    ...validateStyling(rest)
  };

  switch (type) {
    case 'stroke': {
      const { points } = rest;
      if (!Array.isArray(points) || points.length === 0) {
        throw new Error('Stroke element must contain non-empty points array');
      }

      // Check if points are array of {x, y} or flat [x1, y1, x2, y2]
      if (typeof points[0] === 'object' && points[0] !== null) {
        if (points.length > MAX_POINTS_COUNT) {
          throw new Error(`Stroke points array exceeds maximum length of ${MAX_POINTS_COUNT}`);
        }
        sanitized.points = points.map((p, idx) => {
          if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
            throw new Error(`Stroke point at index ${idx} contains invalid coordinates`);
          }
          return { x: p.x, y: p.y };
        });
      } else {
        // Flat array of numbers
        if (points.length % 2 !== 0) {
          throw new Error('Stroke points flat array must contain even number of coordinates');
        }
        if (points.length / 2 > MAX_POINTS_COUNT) {
          throw new Error(`Stroke points array exceeds maximum length of ${MAX_POINTS_COUNT}`);
        }
        for (let i = 0; i < points.length; i++) {
          if (!isFiniteNumber(points[i])) {
            throw new Error(`Stroke coordinate at index ${i} is not a finite number`);
          }
        }
        sanitized.points = [...points];
      }
      break;
    }

    case 'rectangle': {
      const { x, y, width, height } = rest;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        throw new Error('Rectangle requires finite x and y coordinates');
      }
      if (!isFiniteNumber(width) || width < 0 || width > MAX_DIMENSION) {
        throw new Error(`Rectangle width must be between 0 and ${MAX_DIMENSION}`);
      }
      if (!isFiniteNumber(height) || height < 0 || height > MAX_DIMENSION) {
        throw new Error(`Rectangle height must be between 0 and ${MAX_DIMENSION}`);
      }
      sanitized.x = x;
      sanitized.y = y;
      sanitized.width = width;
      sanitized.height = height;
      break;
    }

    case 'circle': {
      const { x, y, radius } = rest;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        throw new Error('Circle requires finite x and y coordinates');
      }
      if (!isFiniteNumber(radius) || radius < 0 || radius > MAX_DIMENSION) {
        throw new Error(`Circle radius must be between 0 and ${MAX_DIMENSION}`);
      }
      sanitized.x = x;
      sanitized.y = y;
      sanitized.radius = radius;
      break;
    }

    case 'text': {
      const { x, y, text, fontSize } = rest;
      if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
        throw new Error('Text element requires finite x and y coordinates');
      }
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT_LENGTH) {
        throw new Error(`Text content must be between 1 and ${MAX_TEXT_LENGTH} characters`);
      }
      sanitized.x = x;
      sanitized.y = y;
      sanitized.text = text;
      if (fontSize !== undefined) {
        if (!isFiniteNumber(fontSize) || fontSize < 1 || fontSize > MAX_FONT_SIZE) {
          throw new Error(`fontSize must be between 1 and ${MAX_FONT_SIZE}`);
        }
        sanitized.fontSize = fontSize;
      }
      break;
    }
  }

  return sanitized;
};

/**
 * Validates updates proposed for an existing canvas element.
 * Rejects modifications to immutable fields (id, createdBy, createdAt, type).
 * @param {object} changes
 * @param {object} existingElement
 * @returns {object} sanitized changes
 */
const validateElementUpdate = (changes, existingElement) => {
  if (!changes || typeof changes !== 'object') {
    throw new Error('Update payload must be an object');
  }

  // Reject modifications to immutable fields
  const immutableFields = ['id', '_id', 'createdBy', 'createdAt', 'type'];
  for (const field of immutableFields) {
    if (changes[field] !== undefined && changes[field] !== existingElement[field]) {
      throw new Error(`Field "${field}" is immutable and cannot be modified`);
    }
  }

  const updated = {};
  const styling = validateStyling(changes);
  Object.assign(updated, styling);

  // Position updates
  if (changes.x !== undefined) {
    if (!isFiniteNumber(changes.x)) throw new Error('Coordinate x must be a finite number');
    updated.x = changes.x;
  }
  if (changes.y !== undefined) {
    if (!isFiniteNumber(changes.y)) throw new Error('Coordinate y must be a finite number');
    updated.y = changes.y;
  }

  // Type-specific field updates
  if (existingElement.type === 'rectangle') {
    if (changes.width !== undefined) {
      if (!isFiniteNumber(changes.width) || changes.width < 0 || changes.width > MAX_DIMENSION) {
        throw new Error(`Rectangle width must be between 0 and ${MAX_DIMENSION}`);
      }
      updated.width = changes.width;
    }
    if (changes.height !== undefined) {
      if (!isFiniteNumber(changes.height) || changes.height < 0 || changes.height > MAX_DIMENSION) {
        throw new Error(`Rectangle height must be between 0 and ${MAX_DIMENSION}`);
      }
      updated.height = changes.height;
    }
  } else if (existingElement.type === 'circle') {
    if (changes.radius !== undefined) {
      if (!isFiniteNumber(changes.radius) || changes.radius < 0 || changes.radius > MAX_DIMENSION) {
        throw new Error(`Circle radius must be between 0 and ${MAX_DIMENSION}`);
      }
      updated.radius = changes.radius;
    }
  } else if (existingElement.type === 'text') {
    if (changes.text !== undefined) {
      if (typeof changes.text !== 'string' || changes.text.length === 0 || changes.text.length > MAX_TEXT_LENGTH) {
        throw new Error(`Text content must be between 1 and ${MAX_TEXT_LENGTH} characters`);
      }
      updated.text = changes.text;
    }
    if (changes.fontSize !== undefined) {
      if (!isFiniteNumber(changes.fontSize) || changes.fontSize < 1 || changes.fontSize > MAX_FONT_SIZE) {
        throw new Error(`fontSize must be between 1 and ${MAX_FONT_SIZE}`);
      }
      updated.fontSize = changes.fontSize;
    }
  } else if (existingElement.type === 'stroke') {
    if (changes.points !== undefined) {
      if (!Array.isArray(changes.points) || changes.points.length === 0) {
        throw new Error('Stroke points cannot be empty');
      }
      if (typeof changes.points[0] === 'object' && changes.points[0] !== null) {
        if (changes.points.length > MAX_POINTS_COUNT) {
          throw new Error(`Stroke points array exceeds maximum length of ${MAX_POINTS_COUNT}`);
        }
        updated.points = changes.points.map((p, idx) => {
          if (!p || !isFiniteNumber(p.x) || !isFiniteNumber(p.y)) {
            throw new Error(`Stroke point at index ${idx} contains invalid coordinates`);
          }
          return { x: p.x, y: p.y };
        });
      } else {
        if (changes.points.length % 2 !== 0 || changes.points.length / 2 > MAX_POINTS_COUNT) {
          throw new Error('Invalid stroke points');
        }
        for (let i = 0; i < changes.points.length; i++) {
          if (!isFiniteNumber(changes.points[i])) throw new Error('Invalid stroke coordinate');
        }
        updated.points = [...changes.points];
      }
    }
  }

  return updated;
};

module.exports = {
  validateNewElement,
  validateElementUpdate,
  MAX_POINTS_COUNT,
  MAX_TEXT_LENGTH,
  MAX_DIMENSION
};
