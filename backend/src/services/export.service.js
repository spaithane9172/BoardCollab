const { createCanvas } = require('canvas');

/**
 * Calculates the bounding box of a collection of canvas elements.
 * @param {Array<object>} elements
 * @param {number} [padding=40]
 * @returns {object} { minX, minY, maxX, maxY, width, height }
 */
function calculateElementsBounds(elements, padding = 40) {
  if (!elements || elements.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 800,
      maxY: 600,
      width: 800,
      height: 600
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const el of elements) {
    if (el.type === 'stroke' && Array.isArray(el.points)) {
      if (typeof el.points[0] === 'object' && el.points[0] !== null) {
        for (const pt of el.points) {
          if (typeof pt.x === 'number' && typeof pt.y === 'number') {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
          }
        }
      } else {
        for (let i = 0; i < el.points.length; i += 2) {
          const x = el.points[i];
          const y = el.points[i + 1];
          if (typeof x === 'number' && typeof y === 'number') {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    } else if (el.type === 'rectangle') {
      const x = typeof el.x === 'number' ? el.x : 0;
      const y = typeof el.y === 'number' ? el.y : 0;
      const w = typeof el.width === 'number' ? el.width : 0;
      const h = typeof el.height === 'number' ? el.height : 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    } else if (el.type === 'circle') {
      const x = typeof el.x === 'number' ? el.x : 0;
      const y = typeof el.y === 'number' ? el.y : 0;
      const r = typeof el.radius === 'number' ? el.radius : 0;
      if (x - r < minX) minX = x - r;
      if (y - r < minY) minY = y - r;
      if (x + r > maxX) maxX = x + r;
      if (y + r > maxY) maxY = y + r;
    } else if (el.type === 'text') {
      const x = typeof el.x === 'number' ? el.x : 0;
      const y = typeof el.y === 'number' ? el.y : 0;
      const fontSize = typeof el.fontSize === 'number' ? el.fontSize : 18;
      const textLen = typeof el.text === 'string' ? el.text.length : 0;
      const approxWidth = textLen * fontSize * 0.65;
      const approxHeight = fontSize * 1.3;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + approxWidth > maxX) maxX = x + approxWidth;
      if (y + approxHeight > maxY) maxY = y + approxHeight;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 600;
  }

  const pad = Number.isFinite(padding) ? Math.max(0, padding) : 40;
  minX = Math.floor(minX - pad);
  minY = Math.floor(minY - pad);
  maxX = Math.ceil(maxX + pad);
  maxY = Math.ceil(maxY + pad);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(100, maxX - minX),
    height: Math.max(100, maxY - minY)
  };
}

/**
 * Renders an array of canvas elements to a PNG Buffer using node-canvas.
 * Supports strokes, rectangles, circles, and text.
 *
 * @param {Array<object>} elements - Persisted canvas elements
 * @param {object} [options={}] - Customization options
 * @param {string} [options.backgroundColor='#080c14'] - Canvas background fill
 * @param {number} [options.padding=40] - Padding around content in pixels
 * @param {boolean} [options.allowEmpty=true] - Whether to allow exporting empty canvases
 * @returns {Buffer} PNG image buffer
 */
function renderCanvasToPng(elements = [], options = {}) {
  const {
    backgroundColor = '#080c14',
    padding = 40,
    allowEmpty = true
  } = options;

  if (!Array.isArray(elements)) {
    const error = new Error('Canvas elements must be an array');
    error.statusCode = 400;
    throw error;
  }

  if (elements.length === 0 && !allowEmpty) {
    const error = new Error('Canvas is empty, nothing to export');
    error.statusCode = 400;
    throw error;
  }

  const bounds = calculateElementsBounds(elements, padding);
  const canvas = createCanvas(bounds.width, bounds.height);
  const ctx = canvas.getContext('2d');

  // Fill canvas background
  if (backgroundColor && backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
  }

  // Handle empty whiteboard representation
  if (elements.length === 0) {
    ctx.font = '16px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Empty Whiteboard', bounds.width / 2, bounds.height / 2);
    return canvas.toBuffer('image/png');
  }

  // Shift coordinate system so minX, minY maps to (0, 0)
  ctx.save();
  ctx.translate(-bounds.minX, -bounds.minY);

  for (const el of elements) {
    if (!el || typeof el !== 'object') continue;

    const opacity = typeof el.opacity === 'number' && Number.isFinite(el.opacity) ? el.opacity : 1;

    switch (el.type) {
      case 'stroke': {
        if (!Array.isArray(el.points) || el.points.length === 0) break;

        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = el.strokeColor || '#f9fafb';
        ctx.lineWidth = typeof el.strokeWidth === 'number' && el.strokeWidth > 0 ? el.strokeWidth : 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        if (typeof el.points[0] === 'object' && el.points[0] !== null) {
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            const pt = el.points[i];
            if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
              ctx.lineTo(pt.x, pt.y);
            }
          }
        } else {
          ctx.moveTo(el.points[0], el.points[1]);
          for (let i = 2; i < el.points.length; i += 2) {
            ctx.lineTo(el.points[i], el.points[i + 1]);
          }
        }
        ctx.stroke();
        ctx.restore();
        break;
      }

      case 'rectangle': {
        ctx.save();
        ctx.globalAlpha = opacity;

        const x = typeof el.x === 'number' ? el.x : 0;
        const y = typeof el.y === 'number' ? el.y : 0;
        const w = typeof el.width === 'number' ? el.width : 0;
        const h = typeof el.height === 'number' ? el.height : 0;

        if (el.fillColor && el.fillColor !== 'transparent') {
          ctx.fillStyle = el.fillColor;
          ctx.fillRect(x, y, w, h);
        }

        const strokeWidth = typeof el.strokeWidth === 'number' ? el.strokeWidth : 2;
        if (strokeWidth > 0 && el.strokeColor && el.strokeColor !== 'transparent') {
          ctx.strokeStyle = el.strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.strokeRect(x, y, w, h);
        }

        ctx.restore();
        break;
      }

      case 'circle': {
        ctx.save();
        ctx.globalAlpha = opacity;

        const x = typeof el.x === 'number' ? el.x : 0;
        const y = typeof el.y === 'number' ? el.y : 0;
        const radius = typeof el.radius === 'number' && el.radius > 0 ? el.radius : 0;

        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        if (el.fillColor && el.fillColor !== 'transparent') {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }

        const strokeWidth = typeof el.strokeWidth === 'number' ? el.strokeWidth : 2;
        if (strokeWidth > 0 && el.strokeColor && el.strokeColor !== 'transparent') {
          ctx.strokeStyle = el.strokeColor;
          ctx.lineWidth = strokeWidth;
          ctx.stroke();
        }

        ctx.restore();
        break;
      }

      case 'text': {
        if (typeof el.text !== 'string' || el.text.length === 0) break;

        ctx.save();
        ctx.globalAlpha = opacity;

        const x = typeof el.x === 'number' ? el.x : 0;
        const y = typeof el.y === 'number' ? el.y : 0;
        const fontSize = typeof el.fontSize === 'number' && el.fontSize > 0 ? el.fontSize : 18;
        const fontFamily = el.fontFamily || 'sans-serif';

        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = el.strokeColor || el.fillColor || '#f9fafb';
        ctx.fillText(el.text, x, y);

        ctx.restore();
        break;
      }

      default:
        break;
    }
  }

  ctx.restore();

  try {
    return canvas.toBuffer('image/png');
  } catch (err) {
    const error = new Error(`Failed to encode PNG image: ${err.message}`);
    error.statusCode = 500;
    throw error;
  }
}

module.exports = {
  calculateElementsBounds,
  renderCanvasToPng
};
