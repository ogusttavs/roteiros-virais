import { NextResponse } from "next/server";

import { LARGURA_MINIMA_DA_FOTO } from "@/carrossel/fotos";
import { TETO_DA_FOTO_BYTES } from "@/config/carrossel";
import { idDoParametro, lerCorpoComTeto, marcaDoCarrossel, respostaDeErro, respostaDoErroDoCarrossel, SEM_CACHE } from "@/lib/porta-do-carrossel";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { enviarFoto } from "@/servicos/carrossel";
import { textosCarrossel } from "@/textos/carrossel";

export const dynamic = "force-dynamic";

/** Manda uma foto (multipart, campo `foto`) para o carrossel da marca da sessão: jpg, png ou webp, até 9 por carrossel, com teto de tamanho. Em marca de saúde, com slide de antes e depois ou de resultado, o campo `autorizacaoDoPaciente=true` confirma a autorização escrita do paciente. */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const marca = await marcaDoCarrossel();
  if (marca instanceof NextResponse) return marca;
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const id = idDoParametro((await contexto.params).id);
  if (id === null) return respostaDeErro("nao encontrado", 404);
  // O teto vale venha ou não o content-length (um corpo em pedaços não declara tamanho): o corpo é lido aos poucos, contando os bytes, e para ao passar do teto, sem guardar o resto na memória.
  const tetoDoCorpo = TETO_DA_FOTO_BYTES + 64 * 1024;
  const declarado = Number(request.headers.get("content-length") ?? 0);
  if (declarado > tetoDoCorpo) return respostaDeErro("A foto é grande demais. Mande uma menor.", 413);
  const corpo = await lerCorpoComTeto(request, tetoDoCorpo);
  if (corpo === "grande-demais") return respostaDeErro("A foto é grande demais. Mande uma menor.", 413);
  let formulario: FormData;
  try {
    formulario = await new Response(corpo, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return respostaDeErro("corpo do pedido invalido", 400);
  }
  const arquivo = formulario.get("foto");
  if (!(arquivo instanceof File)) return respostaDeErro("mande a foto no campo foto", 400);
  try {
    const foto = await enviarFoto(marca.clienteId, id, { tipoDeclarado: arquivo.type, bytes: Buffer.from(await arquivo.arrayBuffer()), autorizacaoDoPaciente: formulario.get("autorizacaoDoPaciente") === "true" });
    // Foto mais estreita que o slide (1080 px) entra, mas a pessoa é avisada de que pode sair borrada.
    const { largura, ...semLargura } = foto;
    const aviso = largura !== null && largura < LARGURA_MINIMA_DA_FOTO ? textosCarrossel.metodo.fotoEstreita(largura) : null;
    return NextResponse.json({ foto: semLargura, aviso }, { headers: SEM_CACHE });
  } catch (erro) {
    const resposta = respostaDoErroDoCarrossel(erro);
    if (resposta) return resposta;
    throw erro;
  }
}
