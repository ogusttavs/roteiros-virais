import { NextResponse } from "next/server";

import { logger } from "@/lib/log";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { ErroMomento, LIMITE_TAMANHO_AUDIO_BYTES, transcreverAudioEnviado } from "@/servicos/momento";

/**
 * P2b, item 2b: a prévia ao vivo sem reconhecimento do navegador manda um pedaço de 5 segundos a
 * cada 5 segundos, até 24 vezes numa gravação de 2 minutos (o teto do gravador). Em memória, por
 * usuário: reinicia a cada deploy, e é só para abuso óbvio, não uma trava de cota paga (a Groq já
 * cobra por segundo de áudio enviado, não por chamada).
 *
 * M4, item 0b da revisão do PR #79: um limite só contava tudo junto, e duas pessoas gravando na
 * mesma conta ao mesmo tempo (o caso da viagem) passavam dos 40 em 2 minutos; quem tomava o 429
 * podia ser a chamada definitiva, perdendo a fala inteira. Agora são dois limites, por usuário e
 * independentes: os pedaços de prévia (`previa=1` no formulário, até 24 esperados, 40 de folga) e
 * a chamada definitiva, que manda o áudio inteiro uma vez por gravação (10 em 2 minutos é folgado
 * mesmo com duas gravações simultâneas na mesma conta).
 */
const JANELA_LIMITE_MS = 2 * 60 * 1000;
const CHAMADAS_MAXIMAS_PREVIA_NA_JANELA = 40;
const CHAMADAS_MAXIMAS_DEFINITIVA_NA_JANELA = 10;
const chamadasPreviaPorUsuario = new Map<string, number[]>();
const chamadasDefinitivaPorUsuario = new Map<string, number[]>();

function dentroDoLimite(mapa: Map<string, number[]>, usuarioId: string, maximoNaJanela: number): boolean {
  const agora = Date.now();
  const historico = (mapa.get(usuarioId) ?? []).filter((quando) => agora - quando < JANELA_LIMITE_MS);
  if (historico.length >= maximoNaJanela) {
    mapa.set(usuarioId, historico);
    return false;
  }
  historico.push(agora);
  mapa.set(usuarioId, historico);
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

  let forma: FormData;
  try {
    forma = await request.formData();
  } catch {
    return NextResponse.json({ erro: "corpo da requisicao invalido" }, { status: 400 });
  }

  const ehPedacoDePrevia = forma.get("previa") === "1";
  const limiteOk = ehPedacoDePrevia
    ? dentroDoLimite(chamadasPreviaPorUsuario, sessao.user.id, CHAMADAS_MAXIMAS_PREVIA_NA_JANELA)
    : dentroDoLimite(chamadasDefinitivaPorUsuario, sessao.user.id, CHAMADAS_MAXIMAS_DEFINITIVA_NA_JANELA);
  if (!limiteOk) {
    return NextResponse.json({ erro: "muitos pedidos de transcricao em pouco tempo; espere um instante." }, { status: 429 });
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
