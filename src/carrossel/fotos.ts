/**
 * E65 PR 2: a distribuição das fotos pelos slides, pura e leve (sem navegador), para o servidor, o render e a tela usarem a mesma conta.
 */
import { SEM_FOTO, TIPOS_COM_FOTO, type SlideDoCarrossel } from "@/config/carrossel";

/**
 * Qual foto vai em qual slide: a que o slide aponta (`fotoId`), e, sem apontar, as fotos que sobraram na ordem em que foram enviadas, só nos tipos que aceitam foto (o antes e depois leva duas).
 * Pura: o teste prova a distribuição sem navegador.
 */
export function distribuirFotos(slides: SlideDoCarrossel[], fotosEmOrdem: { id: number }[]): { foto: number | null; fotoDepois: number | null }[] {
  const existentes = new Set(fotosEmOrdem.map((f) => f.id));
  const apontadas = new Set<number>();
  for (const s of slides) {
    if (s.fotoId && existentes.has(s.fotoId)) apontadas.add(s.fotoId);
    if (s.fotoDepoisId && existentes.has(s.fotoDepoisId)) apontadas.add(s.fotoDepoisId);
  }
  const livres = fotosEmOrdem.filter((f) => !apontadas.has(f.id)).map((f) => f.id);
  return slides.map((s) => {
    if (!TIPOS_COM_FOTO.has(s.tipo)) return { foto: null, fotoDepois: null };
    const foto = s.fotoId === SEM_FOTO ? null : s.fotoId && existentes.has(s.fotoId) ? s.fotoId : (livres.shift() ?? null);
    const fotoDepois = s.tipo !== "antes-depois" || s.fotoDepoisId === SEM_FOTO ? null : s.fotoDepoisId && existentes.has(s.fotoDepoisId) ? s.fotoDepoisId : (livres.shift() ?? null);
    return { foto, fotoDepois };
  });
}

/** O slide tem 1080 px de largura: foto com menos que isso é esticada e pode sair borrada. */
export const LARGURA_MINIMA_DA_FOTO = 1080;

/**
 * A largura em pixels de uma imagem (png, jpeg ou webp) lida só do cabeçalho, sem decodificar, ou nulo se não der para ler. Pura: o envio avisa quando a foto é mais estreita que o slide.
 */
export function larguraDaImagem(bytes: Buffer): number | null {
  try {
    if (bytes.length > 24 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return bytes.readUInt32BE(16);
    if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return null;
        const marcador = bytes[i + 1];
        if (marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador)) return bytes.readUInt16BE(i + 7);
        i += 2 + bytes.readUInt16BE(i + 2);
      }
      return null;
    }
    if (bytes.length > 30 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") {
      const tipo = bytes.subarray(12, 16).toString("latin1");
      if (tipo === "VP8 ") return bytes.readUInt16LE(26) & 0x3fff;
      if (tipo === "VP8L") return 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
      if (tipo === "VP8X") return 1 + bytes.readUIntLE(24, 3);
    }
  } catch {
    return null;
  }
  return null;
}
