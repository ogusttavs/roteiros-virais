import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ErroMomento, LIMITE_TAMANHO_AUDIO_BYTES, transcreverAudioEnviado } from "@/servicos/momento";

/**
 * `/api/momento/transcrever` (V9a, item 3, a folha "Gravar agora"; V9b,
 * item 1, "mesmo botão de áudio, mesma rota" para a agenda): recebe o
 * áudio gravado no navegador (`MediaRecorder`) por `multipart/form-data` e
 * devolve só o texto transcrito pela Groq. Rota, não Server Action (as
 * duas são aceitas pelo plano): um upload de arquivo binário aqui fica mais
 * direto que empacotar em FormData de Server Action, mesmo padrão de
 * `/api/roteiros/[id]/pdf` para a sessão. Separar em momento ou em dias de
 * agenda é responsabilidade de quem chama depois, com o texto devolvido
 * aqui (`lerMomentoDeTextoAction` ou `lerAgendaAction`).
 */
export async function POST(request: Request) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  let forma: FormData;
  try {
    forma = await request.formData();
  } catch {
    return NextResponse.json({ erro: "corpo da requisicao invalido" }, { status: 400 });
  }

  const audio = forma.get("audio");
  const duracaoBruta = forma.get("duracaoS");
  if (!(audio instanceof File) || typeof duracaoBruta !== "string") {
    return NextResponse.json({ erro: "audio ou duracao ausente" }, { status: 400 });
  }
  const duracaoS = Number(duracaoBruta);
  if (!Number.isFinite(duracaoS) || duracaoS <= 0) {
    return NextResponse.json({ erro: "duracao invalida" }, { status: 400 });
  }
  /**
   * Item 0.2 da revisão do PR #55 (V9b): confere o tamanho pelo `size` do
   * `File` antes de ler `arrayBuffer()`, para nunca carregar um arquivo
   * grande demais na memória só para descartar depois.
   */
  if (audio.size > LIMITE_TAMANHO_AUDIO_BYTES) {
    return NextResponse.json({ erro: "esse audio e maior do que conseguimos ouvir, grave um pedaco mais curto" }, { status: 413 });
  }

  try {
    const bytes = Buffer.from(await audio.arrayBuffer());
    const resultado = await transcreverAudioEnviado(bytes, audio.type, duracaoS);
    return NextResponse.json(resultado);
  } catch (erro) {
    if (erro instanceof ErroMomento) {
      return NextResponse.json({ erro: erro.message }, { status: 422 });
    }
    logger.error({ err: erro, clienteId: cliente.id }, "nao foi possivel transcrever o momento");
    return NextResponse.json({ erro: "nao conseguimos entender o audio agora, tente de novo" }, { status: 502 });
  }
}
