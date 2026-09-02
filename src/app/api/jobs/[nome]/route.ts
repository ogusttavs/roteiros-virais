import { NextResponse } from "next/server";

import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";

const NOMES_VALIDOS = new Set<string>(Object.values(FILAS));

/**
 * Dispara um job de fora (etapa 6, decisao do Fable): cabecalho x-jobs-key
 * igual a JOBS_API_KEY, senao 401. O botao "rodar agora" do admin (parte 2)
 * chama esta mesma rota.
 *
 * Enfileira em vez de rodar o job dentro da requisicao (revisao da etapa 6,
 * parte 1, PROXIMO.md): uma coleta pode levar minutos, tempo demais para uma
 * requisicao HTTP seguir aberta. O worker (`src/jobs/worker.ts`) e quem
 * processa a fila e grava o resultado em `execucoes_job`; esta rota so
 * confirma que o job entrou na fila. `npm run job -- <nome>` continua
 * rodando o job direto, sem passar pela fila, para os testes com chave real.
 */
export async function POST(request: Request, { params }: { params: Promise<{ nome: string }> }) {
  const chave = request.headers.get("x-jobs-key");
  if (!chave || chave !== config.jobsApiKey) {
    return NextResponse.json({ erro: "chave invalida ou ausente" }, { status: 401 });
  }

  const { nome } = await params;
  if (!NOMES_VALIDOS.has(nome)) {
    return NextResponse.json({ erro: `job desconhecido: ${nome}` }, { status: 404 });
  }

  try {
    await garantirBossPronto();
  } catch (erro) {
    return NextResponse.json(
      { erro: `fila de jobs indisponivel: ${erro instanceof Error ? erro.message : String(erro)}` },
      { status: 503 },
    );
  }

  const id = await boss().send(nome);
  return NextResponse.json({ ok: true, job: nome, enfileirado: id }, { status: 202 });
}
