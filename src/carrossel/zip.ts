/**
 * E65 PR 1: um zip mínimo, sem compressão (método 0, "stored"): os PNG já vêm comprimidos, então comprimir de novo só gastaria tempo, e assim o projeto não ganha uma biblioteca nova.
 * Só nomes em ASCII (o carrossel usa "slide-01.png").
 */
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function montarZip(arquivos: { nome: string; bytes: Buffer }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "ascii");
    const crc = crc32(a.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(a.bytes.length, 18);
    local.writeUInt32LE(a.bytes.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, a.bytes);
    const entrada = Buffer.alloc(46);
    entrada.writeUInt32LE(0x02014b50, 0);
    entrada.writeUInt16LE(20, 4);
    entrada.writeUInt16LE(20, 6);
    entrada.writeUInt16LE(0, 8);
    entrada.writeUInt16LE(0, 10);
    entrada.writeUInt16LE(0, 12);
    entrada.writeUInt16LE(0x21, 14);
    entrada.writeUInt32LE(crc, 16);
    entrada.writeUInt32LE(a.bytes.length, 20);
    entrada.writeUInt32LE(a.bytes.length, 24);
    entrada.writeUInt16LE(nome.length, 28);
    entrada.writeUInt32LE(deslocamento, 42);
    central.push(entrada, nome);
    deslocamento += 30 + nome.length + a.bytes.length;
  }
  const tamanhoCentral = central.reduce((soma, b) => soma + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamanhoCentral, 12);
  fim.writeUInt32LE(deslocamento, 16);
  return Buffer.concat([...partes, ...central, fim]);
}
