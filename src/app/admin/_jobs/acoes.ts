"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { garantirSessaoAdmin } from "@/servicos/clientes";

/**
 * Dispara um job pelo admin (etapa 6, parte 2, decisao do Fable): chama a
 * mesma rota `POST /api/jobs/[nome]` que qualquer disparo de fora, com a
 * chave lida do ambiente no servidor. A chave nunca chega ao navegador.
 *
 * `dados` (etapa 24, parte 1): `{ nichoId }` escopa o disparo a um nicho so
 * (o botao "coletar agora" da tela do nicho); sem ele, roda para todos os
 * nichos ativos, igual sempre foi.
 */
export async function dispararJobAction(
  nome: string,
  dados?: { nichoId: number },
): Promise<{ ok: boolean; mensagem: string; duplicado?: boolean }> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const resposta = await fetch(`${config.appUrl}/api/jobs/${nome}`, {
      method: "POST",
      headers: {
        "x-jobs-key": config.jobsApiKey,
        ...(dados ? { "content-type": "application/json" } : {}),
      },
      body: dados ? JSON.stringify(dados) : undefined,
      cache: "no-store",
    });
    const corpo = (await resposta.json()) as { erro?: string; duplicado?: boolean };

    revalidatePath("/admin/jobs");
    revalidatePath("/admin/nichos");

    if (!resposta.ok) {
      return { ok: false, mensagem: corpo.erro ?? `a rota respondeu ${resposta.status}` };
    }
    return { ok: true, mensagem: "", duplicado: corpo.duplicado };
  } catch (erro) {
    Sentry.captureException(erro, { tags: { job: nome } });
    return { ok: false, mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}
