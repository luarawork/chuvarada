// Decodificador mínimo de geometria GeoPackage (header GP + WKB) e cálculo
// de centroide por área (shoelace) para Polygon/MultiPolygon. Sem libs
// externas -- geopandas/shapely não estão disponíveis (sem Python no
// ambiente), então isso reimplementa só o necessário: ler X/Y de cada
// anel e computar (area, momentX, momentY) por polígono, somando anéis
// (exterior + buracos já vêm com sinal oposto pela orientação do anel,
// então basta somar todos com a mesma fórmula).

function readGeoPackageGeometry(buf) {
  // Header GeoPackage: 'GP' magic (2 bytes) + version (1) + flags (1) +
  // SRID (4, no byte-order do flags) + envelope opcional + WKB puro.
  if (buf[0] !== 0x47 || buf[1] !== 0x50) {
    throw new Error("magic GP ausente -- não é geometria GeoPackage");
  }
  const flags = buf[3];
  const littleEndian = (flags & 0x01) === 1;
  const envelopeCode = (flags >> 1) & 0x07;
  const envelopeDoubles = { 0: 0, 1: 4, 2: 6, 3: 6, 4: 8 }[envelopeCode] ?? 0;
  const wkbOffset = 8 + envelopeDoubles * 8;
  return buf.subarray(wkbOffset);
}

function readWkbGeometry(buf) {
  let offset = 0;
  const byteOrder = buf.readUInt8(offset);
  offset += 1;
  const le = byteOrder === 1;
  let type = le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  offset += 4;
  // Normaliza variantes EWKB (flags Z/M nos bits altos) e ISO WKB (Z/M
  // como +1000/+2000/+3000) para o tipo base 2D -- setores do Censo são
  // 2D puros, mas ser defensivo aqui evita quebrar silenciosamente.
  const hasSRIDFlag = (type & 0x20000000) !== 0;
  let baseType = type & 0xffff;
  if (baseType > 3000) baseType -= 3000;
  else if (baseType > 2000) baseType -= 2000;
  else if (baseType > 1000) baseType -= 1000;
  if (hasSRIDFlag) offset += 4; // SRID embutido (EWKB), pula

  const readDouble = () => {
    const v = le ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
    offset += 8;
    return v;
  };
  const readUInt32 = () => {
    const v = le ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
    offset += 4;
    return v;
  };

  function readRing() {
    const numPoints = readUInt32();
    const xs = new Float64Array(numPoints);
    const ys = new Float64Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      xs[i] = readDouble();
      ys[i] = readDouble();
    }
    return { xs, ys };
  }

  function readPolygonBody() {
    const numRings = readUInt32();
    const rings = [];
    for (let i = 0; i < numRings; i++) rings.push(readRing());
    return rings;
  }

  if (baseType === 3) {
    // Polygon
    return [readPolygonBody()];
  } else if (baseType === 6) {
    // MultiPolygon: cada elemento é um WKB completo (byte-order + type + corpo)
    const numPolys = readUInt32();
    const polys = [];
    for (let i = 0; i < numPolys; i++) {
      offset += 1; // byte order do sub-wkb (assumimos igual ao pai; robusto o bastante aqui)
      offset += 4; // type do sub-wkb (deve ser Polygon=3)
      polys.push(readPolygonBody());
    }
    return polys;
  } else {
    throw new Error(`tipo de geometria não suportado: ${type} (base ${baseType})`);
  }
}

// Centroide por área (shoelace), somando todos os anéis de todos os
// polígonos -- funciona pra Polygon-com-buracos e MultiPolygon porque
// anéis internos (buracos) têm orientação oposta ao externo, cancelando
// a área/momento correspondente automaticamente.
function polygonCentroid(polygons) {
  let area2 = 0; // 2x a área assinada acumulada
  let cxAcc = 0;
  let cyAcc = 0;
  for (const rings of polygons) {
    for (const { xs, ys } of rings) {
      const n = xs.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const cross = xs[i] * ys[j] - xs[j] * ys[i];
        area2 += cross;
        cxAcc += (xs[i] + xs[j]) * cross;
        cyAcc += (ys[i] + ys[j]) * cross;
      }
    }
  }
  if (Math.abs(area2) < 1e-12) return null; // geometria degenerada
  const area = area2 / 2;
  return { lng: cxAcc / (6 * area), lat: cyAcc / (6 * area), area: Math.abs(area) };
}

function geometryCentroidFromGpkgBlob(blob) {
  // node:sqlite entrega BLOB como Uint8Array, não Buffer -- os métodos
  // readUInt32LE/readDoubleLE etc só existem em Buffer.
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const wkb = readGeoPackageGeometry(buf);
  const polygons = readWkbGeometry(wkb);
  return polygonCentroid(polygons);
}

module.exports = { geometryCentroidFromGpkgBlob, readGeoPackageGeometry, readWkbGeometry, polygonCentroid };
