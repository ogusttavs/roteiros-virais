import { NextResponse } from "next/server";

import { TETO_DA_FOTO_BYTES } from "@/config/carrossel";
import { idDoParametro, marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { enviarFoto } from "@/servicos/carrossel";

export const dynamic = "force-dynamic";

/** Manda uma foto (multipart, campo `foto`) para o carrossel da marca da sessão: jpg, png ou webp, até 9 por carrossel, com teto de tamanho. */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  // O corpo inteiro só é lido se o tamanho declarado cabe (a conferência dos bytes vem depois, no serviço).
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > TETO_DA_FOTO_BYTES + 64 * 1024) return respostaDeErro("A foto é grande demais. Mande uma menor.", 413);
  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return respostaDeErro("corpo do pedido invalido", 400);
  }
  const arquivo = formulario.get("foto");
  if (!(arquivo instanceof File)) return respostaDeErro("mande a foto no campo foto", 400);
  try {
    const foto = await enviarFoto(marca.clienteId, id, { tipoDeclarado: arquivo.type, bytes: Buffer.from(await arquivo.arrayBuffer()) });
    return NextResponse.json({ foto }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    throw erro;
  }
}
