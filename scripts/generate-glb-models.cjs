// Script to generate simple GLB placeholder models for liquid glass effect
// Run with: node scripts/generate-glb-models.js

const fs = require('fs');
const path = require('path');

// Minimal GLB structure for simple primitives
// GLB = GLTF Binary format (header + JSON chunk + binary buffer chunk)

function createGLB(geometry, name) {
  const gltf = {
    asset: { version: "2.0", generator: "pawtropolis-glb-generator" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1
          }
        ]
      }
    ],
    buffers: [{ byteLength: geometry.bufferLength }],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: geometry.positions.byteLength,
        target: 34962 // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: geometry.positions.byteLength,
        byteLength: geometry.indices.byteLength,
        target: 34963 // ELEMENT_ARRAY_BUFFER
      }
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: geometry.positions.byteLength / 12,
        type: "VEC3",
        max: geometry.max,
        min: geometry.min
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5123, // UNSIGNED_SHORT
        count: geometry.indices.length,
        type: "SCALAR"
      }
    ]
  };

  const jsonString = JSON.stringify(gltf);
  const jsonBuffer = Buffer.from(jsonString);
  const jsonPadding = (4 - (jsonBuffer.length % 4)) % 4;
  const jsonChunkLength = jsonBuffer.length + jsonPadding;

  const binaryBuffer = Buffer.concat([geometry.positions, geometry.indices]);
  const binaryPadding = (4 - (binaryBuffer.length % 4)) % 4;
  const binaryChunkLength = binaryBuffer.length + binaryPadding;

  const totalLength = 12 + 8 + jsonChunkLength + 8 + binaryChunkLength;

  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  // GLB header
  glb.writeUInt32LE(0x46546C67, offset); offset += 4; // magic "glTF"
  glb.writeUInt32LE(2, offset); offset += 4; // version
  glb.writeUInt32LE(totalLength, offset); offset += 4; // total length

  // JSON chunk
  glb.writeUInt32LE(jsonChunkLength, offset); offset += 4;
  glb.writeUInt32LE(0x4E4F534A, offset); offset += 4; // "JSON"
  jsonBuffer.copy(glb, offset); offset += jsonBuffer.length;
  offset += jsonPadding;

  // Binary chunk
  glb.writeUInt32LE(binaryChunkLength, offset); offset += 4;
  glb.writeUInt32LE(0x004E4942, offset); offset += 4; // "BIN\0"
  binaryBuffer.copy(glb, offset); offset += binaryBuffer.length;

  return glb;
}

// Lens geometry (torus/disc shape)
function createLensGeometry() {
  const positions = [];
  const indices = [];
  const segments = 32;
  const radius = 0.8;
  const thickness = 0.15;

  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.push(x, thickness, z);
    positions.push(x, -thickness, z);
  }

  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  const positionsBuffer = Buffer.allocUnsafe(positions.length * 4);
  positions.forEach((v, i) => positionsBuffer.writeFloatLE(v, i * 4));

  const indicesBuffer = Buffer.allocUnsafe(indices.length * 2);
  indices.forEach((v, i) => indicesBuffer.writeUInt16LE(v, i * 2));

  return {
    positions: positionsBuffer,
    indices: indicesBuffer,
    bufferLength: positionsBuffer.length + indicesBuffer.length,
    max: [radius, thickness, radius],
    min: [-radius, -thickness, -radius]
  };
}

// Bar geometry (elongated box)
function createBarGeometry() {
  const positions = new Float32Array([
    -1.2, -0.1, -0.1,  1.2, -0.1, -0.1,  1.2,  0.1, -0.1, -1.2,  0.1, -0.1,
    -1.2, -0.1,  0.1,  1.2, -0.1,  0.1,  1.2,  0.1,  0.1, -1.2,  0.1,  0.1
  ]);

  const indices = new Uint16Array([
    0,1,2, 0,2,3,  4,6,5, 4,7,6,
    0,4,7, 0,7,3,  1,5,6, 1,6,2,
    0,1,5, 0,5,4,  3,2,6, 3,6,7
  ]);

  return {
    positions: Buffer.from(positions.buffer),
    indices: Buffer.from(indices.buffer),
    bufferLength: positions.byteLength + indices.byteLength,
    max: [1.2, 0.1, 0.1],
    min: [-1.2, -0.1, -0.1]
  };
}

// Cube geometry
function createCubeGeometry() {
  const s = 0.6;
  const positions = new Float32Array([
    -s,-s,-s,  s,-s,-s,  s, s,-s, -s, s,-s,
    -s,-s, s,  s,-s, s,  s, s, s, -s, s, s
  ]);

  const indices = new Uint16Array([
    0,1,2, 0,2,3,  4,6,5, 4,7,6,
    0,4,7, 0,7,3,  1,5,6, 1,6,2,
    0,1,5, 0,5,4,  3,2,6, 3,6,7
  ]);

  return {
    positions: Buffer.from(positions.buffer),
    indices: Buffer.from(indices.buffer),
    bufferLength: positions.byteLength + indices.byteLength,
    max: [s, s, s],
    min: [-s, -s, -s]
  };
}

// Generate all models
const outputDir = path.join(__dirname, '../website/assets/3d');
fs.mkdirSync(outputDir, { recursive: true });

const models = [
  { name: 'lens', geometry: createLensGeometry() },
  { name: 'bar', geometry: createBarGeometry() },
  { name: 'cube', geometry: createCubeGeometry() }
];

models.forEach(({ name, geometry }) => {
  const glb = createGLB(geometry, name);
  const outputPath = path.join(outputDir, `${name}.glb`);
  fs.writeFileSync(outputPath, glb);
  console.log(`✓ Generated ${name}.glb (${glb.length} bytes)`);
});

console.log('\n✓ All GLB models generated successfully');
