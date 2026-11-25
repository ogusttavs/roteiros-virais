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
