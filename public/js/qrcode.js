/**
 * Pure JavaScript ISO/IEC 18004 QR Code Generator (Byte Mode, EC Level M, Versions 1-10)
 * Produces scannable crisp SVG QR codes with zero external dependencies.
 */
(function (global) {
  'use strict';

  // GF(256) tables with primitive polynomial 0x11d
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      EXP[i] = EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGeneratorPoly(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsCompute(data, ecCount) {
    const gen = rsGeneratorPoly(ecCount);
    const rem = new Uint8Array(ecCount);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ rem[0];
      for (let j = 0; j < ecCount - 1; j++) {
        rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      rem[ecCount - 1] = gfMul(gen[ecCount], factor);
    }
    return rem;
  }

  // Version specs for EC Level M (versions 1..10)
  // [totalDataCodewords, ecPerBlock, [[blockCount, dataPerBlock], ...], alignmentCenters]
  const VERSION_SPECS = [
    null,
    [16,  10, [[1, 16]], []],
    [28,  16, [[1, 28]], [6, 18]],
    [44,  26, [[1, 44]], [6, 22]],
    [64,  18, [[2, 32]], [6, 26]],
    [86,  24, [[2, 43]], [6, 30]],
    [108, 16, [[4, 27]], [6, 34]],
    [124, 18, [[4, 31]], [6, 22, 38]],
    [154, 22, [[2, 38], [2, 39]], [6, 24, 42]],
    [182, 22, [[3, 36], [2, 37]], [6, 26, 46]],
    [216, 26, [[4, 43], [1, 44]], [6, 28, 50]]
  ];

  // Format info strings for EC Level M (00) + mask 0..7 (precomputed BCH(15,5) ^ 0x5412)
  const FORMAT_INFO_M = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b,
    0x45f9, 0x40ce, 0x4f97, 0x4aa0
  ];

  // Version info 18-bit BCH(18,6) for versions 7..10
  const VERSION_INFO = {
    7:  0x07c94,
    8:  0x085bc,
    9:  0x09a99,
    10: 0x0a4d3
  };

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') {
      return Array.from(new TextEncoder().encode(str));
    }
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return bytes;
  }

  function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const totalData = VERSION_SPECS[v][0];
      const countBits = v <= 9 ? 8 : 16;
      const neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= totalData * 8) return v;
    }
    throw new Error('QR payload too long (max 213 bytes)');
  }

  function buildCodewords(bytes, version) {
    const [totalData, ecPerBlock, blockGroups] = VERSION_SPECS[version];
    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode indicator: 0100
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (const b of bytes) pushBits(b, 8);

    // Terminator up to 4 zero bits
    const capacityBits = totalData * 8;
    const termLen = Math.min(4, capacityBits - bits.length);
    pushBits(0, termLen);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Convert bits to data bytes
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      data.push(byte);
    }

    // Pad codewords alternating 0xEC, 0x11
    const pads = [0xec, 0x11];
    let padIdx = 0;
    while (data.length < totalData) {
      data.push(pads[padIdx % 2]);
      padIdx++;
    }

    // Split into RS blocks
    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (const [count, blockDataLen] of blockGroups) {
      for (let b = 0; b < count; b++) {
        const block = data.slice(offset, offset + blockDataLen);
        offset += blockDataLen;
        dataBlocks.push(block);
        ecBlocks.push(Array.from(rsCompute(block, ecPerBlock)));
      }
    }

    // Interleave data codewords, then EC codewords
    const result = [];
    const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
    for (let i = 0; i < maxDataLen; i++) {
      for (const blk of dataBlocks) {
        if (i < blk.length) result.push(blk[i]);
      }
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (const ec of ecBlocks) {
        result.push(ec[i]);
      }
    }
    return result;
  }

  function createMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (r, c, dark) => {
      if (r >= 0 && r < size && c >= 0 && c < size) {
        modules[r][c] = dark ? 1 : 0;
        isFunc[r][c] = 1;
      }
    };

    // Finder patterns + separators
    const drawFinder = (top, left) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = top + dr;
          const c = left + dc;
          if (r < 0 || r >= size || c < 0 || c >= size) continue;
          const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
          const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFunc(r, c, inOuter && (onBorder || inInner));
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    // Alignment patterns
    const centers = VERSION_SPECS[version][3];
    for (const r of centers) {
      for (const c of centers) {
        if (isFunc[r][c]) continue; // Skip finder overlaps
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const dist = Math.max(Math.abs(dr), Math.abs(dc));
            setFunc(r + dr, c + dc, dist !== 1);
          }
        }
      }
    }

    // Reserve format info areas + dark module
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        setFunc(8, i, false);
        setFunc(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      setFunc(8, size - 1 - i, false);
      setFunc(size - 1 - i, 8, false);
    }
    setFunc(size - 8, 8, true); // Dark module

    // Version info for v >= 7
    if (version >= 7) {
      const vBits = VERSION_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = ((vBits >>> i) & 1) === 1;
        const a = Math.floor(i / 3);
        const b = size - 11 + (i % 3);
        setFunc(a, b, bit);
        setFunc(b, a, bit);
      }
    }

    return { size, modules, isFunc };
  }

  function placeData(matrix, codewords) {
    const { size, modules, isFunc } = matrix;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;

    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // Skip vertical timing column
      for (let step = 0; step < size; step++) {
        const r = upward ? size - 1 - step : step;
        for (let offset = 0; offset < 2; offset++) {
          const c = right - offset;
          if (!isFunc[r][c]) {
            let bit = 0;
            if (bitIdx < totalBits) {
              bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
              bitIdx++;
            }
            modules[r][c] = bit;
          }
        }
      }
      upward = !upward;
    }
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function applyMaskAndFormat(matrix, mask) {
    const { size, modules, isFunc } = matrix;
    const grid = modules.map((row) => new Uint8Array(row));
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && maskBit(mask, r, c)) {
          grid[r][c] ^= 1;
        }
      }
    }

    const fmt = FORMAT_INFO_M[mask];
    // Bit 14 is MSB, Bit 0 is LSB
    const bit = (i) => (fmt >>> i) & 1;

    // Top-left horizontal & vertical
    for (let i = 0; i <= 5; i++) grid[8][i] = bit(14 - i);
    grid[8][7] = bit(8);
    grid[8][8] = bit(7);
    grid[7][8] = bit(6);
    for (let i = 0; i <= 5; i++) grid[5 - i][8] = bit(5 - i);

    // Bottom-left vertical & top-right horizontal
    for (let i = 0; i <= 6; i++) grid[size - 1 - i][8] = bit(14 - i);
    for (let i = 0; i <= 7; i++) grid[8][size - 8 + i] = bit(7 - i);

    return grid;
  }

  function penaltyScore(grid) {
    const n = grid.length;
    let score = 0;

    // Rule 1: Runs of 5+ same color in rows and cols
    for (let r = 0; r < n; r++) {
      let runVal = grid[r][0], runLen = 1;
      for (let c = 1; c < n; c++) {
        if (grid[r][c] === runVal) runLen++;
        else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runVal = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }
    for (let c = 0; c < n; c++) {
      let runVal = grid[0][c], runLen = 1;
      for (let r = 1; r < n; r++) {
        if (grid[r][c] === runVal) runLen++;
        else {
          if (runLen >= 5) score += 3 + (runLen - 5);
          runVal = grid[r][c];
          runLen = 1;
        }
      }
      if (runLen >= 5) score += 3 + (runLen - 5);
    }

    // Rule 2: 2x2 blocks
    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const v = grid[r][c];
        if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
          score += 3;
        }
      }
    }

    // Rule 4: Dark balance
    let dark = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) dark += grid[r][c];
    }
    const pct = (dark * 100) / (n * n);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function generateMatrix(text) {
    const bytes = utf8Bytes(String(text));
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    const matrix = createMatrix(version);
    placeData(matrix, codewords);

    let bestGrid = null;
    let bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      const candidate = applyMaskAndFormat(matrix, m);
      const s = penaltyScore(candidate);
      if (s < bestScore) {
        bestScore = s;
        bestGrid = candidate;
      }
    }
    return bestGrid;
  }

  function toSVG(text, opts = {}) {
    const grid = generateMatrix(text);
    const n = grid.length;
    const quiet = opts.margin != null ? opts.margin : 4;
    const total = n + quiet * 2;
    const fg = opts.fg || '#1E1916';
    const bg = opts.bg || '#FFFFFF';
    const sizeAttr = opts.size ? `width="${opts.size}" height="${opts.size}"` : '';

    const paths = [];
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (grid[r][c]) {
          const start = c;
          while (c < n && grid[r][c]) c++;
          const len = c - start;
          paths.push(`M${start + quiet},${r + quiet}h${len}v1h-${len}z`);
        } else {
          c++;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ${sizeAttr} shape-rendering="crispEdges" role="img" aria-label="QR Code for ${text.replace(/"/g, '&quot;')}"><rect width="${total}" height="${total}" fill="${bg}"/><path d="${paths.join('')}" fill="${fg}"/></svg>`;
  }

  global.QRCodeGen = { generateMatrix, toSVG };
})(window);
