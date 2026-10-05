import { timingSafeEqual } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";


import { db } from "@/db";
import { nichos } from "@/db/schema";
import { boss, existeJobPendente, FILAS, FILAS_POR_EVENTO, garantirBossPronto } from "@/jobs/fila";
import { config } from "@/lib/config";

const NOMES_VALIDOS = new Set<string>(Object.values(FILAS));

/**
 * Comparacao em tempo constante (revisao da etapa 6, parte 2): evita que o
 * tempo de resposta vaze quantos caracteres da chave estao certos.
 */
function chaveValida(recebida: string): boolean {
  const esperada = Buffer.from(config.jobsApiKey);
  const dada = Buffer.from(recebida);
  if (esperada.length !== dada.length) return false;
  return timingSafeEqual(esperada, dada);
}

/**
 * Corpo opcional (etapa 24, parte 1): "coletar agora" manda `{ nichoId }`
 * para escopar a coleta a um nicho; todo outro disparo (cron, `/admin/jobs`)
 * continua sem corpo nenhum. Corpo ausente ou malformado vale como vazio,
 * em vez de reprovar a requisicao por um detalhe que nao muda o disparo.
 */
async function corpoOpcional(request: Request): Promise<{ nichoId?: number }> {
  const texto = await request.text();
  if (!texto) return {};
  try {
    const dados = JSON.parse(texto) as { nichoId?: unknown };
    return typeof dados.nichoId === "number" ? { nichoId: dados.nichoId } : {};
  } catch {
    return {};
  }
}

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
  if (!chave || !chaveValida(chave)) {
    return NextResponse.json({ erro: "chave invalida ou ausente" }, { status: 401 });
  }

  const { nome } = await params;
  if (!NOMES_VALIDOS.has(nome)) {
    return NextResponse.json({ erro: `job desconhecido: ${nome}` }, { status: 404 });
  }
  if (FILAS_POR_EVENTO.has(nome)) {
    return NextResponse.json({ erro: "job por evento, não roda pelo admin" }, { status: 400 });
  }

  const { nichoId } = await corpoOpcional(request);
  // Um ramo que não existe não entra na fila: o worker falharia na chave estrangeira ao registrar a execução.
  if (nichoId !== undefined) {
    const [ramo] = await db().select({ id: nichos.id }).from(nichos).where(eq(nichos.id, nichoId));
    if (!ramo) return NextResponse.json({ erro: `ramo desconhecido: ${nichoId}` }, { status: 400 });
  }

  try {
    await garantirBossPronto();
  } catch (erro) {
    return NextResponse.json(
      { erro: `fila de jobs indisponivel: ${erro instanceof Error ? erro.message : String(erro)}` },
      { status: 503 },
    );
  }

  // Dois cliques, ou dois admins: um job igual já na fila (ou rodando) não entra de novo. Vale com e sem `nichoId` (a coleta paga rodaria em dobro).
  if (await existeJobPendente(nome, nichoId || undefined)) {
    return NextResponse.json({ ok: true, job: nome, enfileirado: null, duplicado: true }, { status: 202 });
  }

  // Rede de segurança para dois pedidos no mesmo instante, antes de qualquer um aparecer como pendente: a mesma chave por 30 segundos vira um só.
  const id = await boss().send(nome, nichoId ? { nichoId } : undefined, { singletonKey: nichoId ? `${nome}-${nichoId}` : nome, singletonSeconds: 30 });
  if (id === null) return NextResponse.json({ ok: true, job: nome, enfileirado: null, duplicado: true }, { status: 202 });
  return NextResponse.json({ ok: true, job: nome, enfileirado: id, duplicado: false }, { status: 202 });
}
