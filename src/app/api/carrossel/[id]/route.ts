import { NextResponse } from "next/server";

import { idDoParametro, marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { distribuirFotos } from "@/carrossel/fotos";
import { slidesComFoto } from "@/carrossel/regras";
import { carrosselDaMarca, fotosDoCarrossel, trocarCor, trocarSlide } from "@/servicos/carrossel";
import { textosCarrossel } from "@/textos/carrossel";

export const dynamic = "force-dynamic";

/** Um carrossel da marca da sessão, com os slides, a legenda e a lista de fotos (sem os bytes). De outra marca, 404. */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  const carrossel = id === null ? null : await carrosselDaMarca(marca.clienteId, id);
  if (!carrossel) return respostaDeErro("nao encontrado", 404);
  const fotos = await fotosDoCarrossel(marca.clienteId, carrossel.id);
  // Quais fotos caem em quais slides (a mesma conta do render): a tela mostra a foto de cada slide e usa o limite menor nos que levam foto.
  const fotosDosSlides = distribuirFotos(carrossel.slides, fotos);
  return NextResponse.json({ carrossel, fotos, fotosDosSlides, slidesComFoto: slidesComFoto(carrossel.slides, fotos.length) }, { headers: SEM_CACHE });
}

const CHAVES_DE_TEXTO = ["rotulo", "titulo", "sub", "texto", "antes", "depois", "valor", "unidade", "frase", "fonte", "referencia", "citacao", "quem", "contexto", "veiculo", "data"] as const;
const listaDeTextos = (v: unknown): string[] | undefined => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

/**
 * Troca um slide: `{ indice, campos?: { titulo, texto, ... }, listas?: { linhas, acoes }, foco?, fotoId?, fotoDepoisId?, autorizacaoDoPaciente? }`, ou a cor do carrossel: `{ cor: "#rrggbb" }` (sem `indice`).
 * O tipo do slide não muda; cada campo passa pelo limite do tipo e o que passa é recusado com o motivo (400).
 */
export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  let corpo: Record<string, unknown>;
  try {
    corpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return respostaDeErro("corpo do pedido invalido", 400);
  }
  try {
    if (typeof corpo.cor === "string" && corpo.indice === undefined) {
      return NextResponse.json({ carrossel: await trocarCor(marca.clienteId, id, corpo.cor) }, { headers: SEM_CACHE });
    }
    if (typeof corpo.indice !== "number") return respostaDeErro("diga qual slide", 400);
    const numeroOuNulo = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" ? v : undefined);
    const bruto = (corpo.campos && typeof corpo.campos === "object" ? corpo.campos : {}) as Record<string, unknown>;
    const campos: Partial<Record<(typeof CHAVES_DE_TEXTO)[number], string>> = {};
    for (const chave of CHAVES_DE_TEXTO) if (typeof bruto[chave] === "string") campos[chave] = bruto[chave] as string;
    const listasBrutas = (corpo.listas && typeof corpo.listas === "object" ? corpo.listas : {}) as Record<string, unknown>;
    const atualizado = await trocarSlide(
      marca.clienteId,
      id,
      corpo.indice,
      {
        campos,
        listas: { linhas: listaDeTextos(listasBrutas.linhas), acoes: listaDeTextos(listasBrutas.acoes) },
        foco: corpo.foco === null ? null : typeof corpo.foco === "string" ? corpo.foco : undefined,
        fotoId: numeroOuNulo(corpo.fotoId),
        fotoDepoisId: numeroOuNulo(corpo.fotoDepoisId),
        autorizacaoDoPaciente: corpo.autorizacaoDoPaciente === true,
      },
      textosCarrossel.campos,
    );
    return NextResponse.json({ carrossel: atualizado }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    throw erro;
  }
}
