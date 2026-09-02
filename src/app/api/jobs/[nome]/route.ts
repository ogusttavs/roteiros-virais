import { NextResponse } from "next/server";

import { rodarColetaNoticias } from "@/jobs/coleta-noticias";
import { rodarColetaYoutube } from "@/jobs/coleta-youtube";
import { executarComRegistro } from "@/jobs/execucoes";
import { FILAS } from "@/jobs/fila";
import { config } from "@/lib/config";

const TAREFAS: Record<string, () => Promise<Record<string, unknown>>> = {
  [FILAS.coletaYoutube]: rodarColetaYoutube,
  [FILAS.coletaNoticias]: rodarColetaNoticias,
};

/**
 * Dispara um job de fora (etapa 6, decisao do Fable): cabecalho x-jobs-key
 * igual a JOBS_API_KEY, senao 401. O botao "rodar agora" do admin (parte 2)
 * chama esta mesma rota.
 */
export async function POST(request: Request, { params }: { params: Promise<{ nome: string }> }) {
  const chave = request.headers.get("x-jobs-key");
  if (!chave || chave !== config.jobsApiKey) {
    return NextResponse.json({ erro: "chave invalida ou ausente" }, { status: 401 });
  }

  const { nome } = await params;
  const tarefa = TAREFAS[nome];
  if (!tarefa) {
    return NextResponse.json({ erro: `job desconhecido: ${nome}` }, { status: 404 });
  }

  try {
    const resultado = await executarComRegistro(nome, tarefa);
    if (resultado.status === "erro") {
      return NextResponse.json({ ok: false, job: nome, erro: resultado.erro }, { status: 502 });
    }
    return NextResponse.json({ ok: true, job: nome, resumo: resultado.resumo });
  } catch (erro) {
    return NextResponse.json(
      { ok: false, job: nome, erro: erro instanceof Error ? erro.message : String(erro) },
      { status: 502 },
    );
  }
}
