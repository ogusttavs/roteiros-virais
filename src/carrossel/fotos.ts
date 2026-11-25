/**
 * E65 PR 2: a distribuição das fotos pelos slides, pura e leve (sem navegador), para o servidor, o render e a tela usarem a mesma conta.
 */
import { SEM_FOTO, TIPOS_COM_FOTO, TIPOS_COM_FOTO_DE_PACIENTE, type SlideDoCarrossel } from "@/config/carrossel";

import { TIPOS_ILUSTRADOS_COMO_FUNDO } from "./ilustracao";

/**
 * Qual foto vai em qual slide: a que o slide aponta (`fotoId`), e, sem apontar, as fotos que sobraram na ordem em que foram enviadas, só nos tipos que aceitam foto (o antes e depois leva duas).
 * Com `separarPaciente` (marca de saúde, E65 PR 5), os dois tipos de foto nunca se misturam: antes e depois e resultado só recebem foto de paciente (`dePaciente`), e os demais tipos só recebem foto comum,
 * tanto na distribuição automática quanto numa foto que o slide aponta. Fora da saúde, uma foto só vale para qualquer tipo, como sempre.
 * Pura: o teste prova a distribuição sem navegador.
 */
export function distribuirFotos(slides: SlideDoCarrossel[], fotosEmOrdem: { id: number; dePaciente?: boolean }[], separarPaciente = false): { foto: number | null; fotoDepois: number | null }[] {
  const porId = new Map(fotosEmOrdem.map((f) => [f.id, f] as const));
  const serve = (id: number | null | undefined, tipo: SlideDoCarrossel["tipo"]): id is number => {
    const f = id ? porId.get(id) : undefined;
    return Boolean(f) && (!separarPaciente || (f!.dePaciente === true) === TIPOS_COM_FOTO_DE_PACIENTE.has(tipo));
  };
  const apontadas = new Set<number>();
  for (const s of slides) {
    if (serve(s.fotoId, s.tipo)) apontadas.add(s.fotoId);
    if (serve(s.fotoDepoisId, s.tipo)) apontadas.add(s.fotoDepoisId);
  }
  const livres = fotosEmOrdem.filter((f) => !apontadas.has(f.id));
  const proxima = (tipo: SlideDoCarrossel["tipo"]): number | null => {
    const i = livres.findIndex((f) => !separarPaciente || (f.dePaciente === true) === TIPOS_COM_FOTO_DE_PACIENTE.has(tipo));
    return i < 0 ? null : livres.splice(i, 1)[0].id;
  };
  return slides.map((s) => {
    if (!TIPOS_COM_FOTO.has(s.tipo)) return { foto: null, fotoDepois: null };
    const foto = s.fotoId === SEM_FOTO ? null : serve(s.fotoId, s.tipo) ? s.fotoId : proxima(s.tipo);
    const fotoDepois = s.tipo !== "antes-depois" || s.fotoDepoisId === SEM_FOTO ? null : serve(s.fotoDepoisId, s.tipo) ? s.fotoDepoisId : proxima(s.tipo);
    return { foto, fotoDepois };
  });
}

/**
 * E69: a foto da PESSOA que vira o fundo de um slide de texto (item, capa de texto, dado, resumo, chamada) no lugar da ilustracao: so a que o slide aponta (`fotoId`), nunca por sobra da ordem. Em saude, foto de paciente
 * nunca serve a esses slides. Nulo quando nao ha. O passo com foto usa o modelo de foto (`distribuirFotos`) e nao passa por aqui.
 */
export function fotoDeFundoDoSlide(slide: SlideDoCarrossel, fotosEmOrdem: { id: number; dePaciente?: boolean }[], separarPaciente = false): number | null {
  if (!TIPOS_ILUSTRADOS_COMO_FUNDO.has(slide.tipo) || slide.tipo === "passo" || !slide.fotoId || slide.fotoId === SEM_FOTO) return null;
  const foto = fotosEmOrdem.find((f) => f.id === slide.fotoId);
  if (!foto || (separarPaciente && foto.dePaciente === true)) return null;
  return foto.id;
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
