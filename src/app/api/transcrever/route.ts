import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ErroMomento, LIMITE_TAMANHO_AUDIO_BYTES, transcreverAudioEnviado } from "@/servicos/momento";

/**
 * P2b, item 2b: a prévia ao vivo sem reconhecimento do navegador manda um pedaço de 5 segundos a
 * cada 5 segundos, até 24 vezes numa gravação de 2 minutos (o teto do gravador). Em memória, por
 * usuário: reinicia a cada deploy, e é só para abuso óbvio, não uma trava de cota paga (a Groq já
 * cobra por segundo de áudio enviado, não por chamada). 40 chamadas numa janela de 2 minutos dá
 * folga sobre as 24 esperadas sem abrir para um script mandando centenas de requisições.
 */
const JANELA_LIMITE_MS = 2 * 60 * 1000;
const CHAMADAS_MAXIMAS_NA_JANELA = 40;
const chamadasPorUsuario = new Map<string, number[]>();

function dentroDoLimite(usuarioId: string): boolean {
  const agora = Date.now();
  const historico = (chamadasPorUsuario.get(usuarioId) ?? []).filter((quando) => agora - quando < JANELA_LIMITE_MS);
  if (historico.length >= CHAMADAS_MAXIMAS_NA_JANELA) {
    chamadasPorUsuario.set(usuarioId, historico);
    return false;
  }
  historico.push(agora);
  chamadasPorUsuario.set(usuarioId, historico);
  return true;
}

/**
 * `/api/transcrever` (P2, item 1: deixou de ser "do momento", `/api/momento/transcrever` agora só
 * chama esta mesma função, para nada quebrar no ar). Recebe o áudio gravado no navegador
 * (`MediaRecorder`) por `multipart/form-data` e devolve só o texto transcrito pela Groq. Rota, não
 * Server Action: um upload de arquivo binário aqui fica mais direto que empacotar em FormData de
 * Server Action, mesmo padrão de `/api/roteiros/[id]/pdf` para a sessão. Separar o texto em
 * momento, dias de agenda ou organizar a fala do briefing é responsabilidade de quem chama depois
 * (`lerMomentoDeTextoAction`, `lerAgendaAction`, `organizarFalaBriefingAction`).
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
  if (!dentroDoLimite(sessao.user.id)) {
    return NextResponse.json({ erro: "muitos pedidos de transcricao em pouco tempo; espere um instante." }, { status: 429 });
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
    logger.error({ err: erro, clienteId: cliente.id }, "nao foi possivel transcrever o audio");
    return NextResponse.json({ erro: "nao conseguimos entender o audio agora, tente de novo" }, { status: 502 });
  }
}
