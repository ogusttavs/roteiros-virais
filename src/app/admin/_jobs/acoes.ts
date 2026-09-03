"use server";

import { revalidatePath } from "next/cache";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { garantirSessaoAdmin } from "@/servicos/clientes";

/**
 * Dispara um job pelo admin (etapa 6, parte 2, decisao do Fable): chama a
 * mesma rota `POST /api/jobs/[nome]` que qualquer disparo de fora, com a
 * chave lida do ambiente no servidor. A chave nunca chega ao navegador.
 */
export async function dispararJobAction(nome: string): Promise<{ ok: boolean; mensagem: string }> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const resposta = await fetch(`${config.appUrl}/api/jobs/${nome}`, {
      method: "POST",
      headers: { "x-jobs-key": config.jobsApiKey },
      cache: "no-store",
    });
    const corpo = (await resposta.json()) as { erro?: string };

    revalidatePath("/admin/jobs");
    revalidatePath("/admin/nichos");

    if (!resposta.ok) {
      return { ok: false, mensagem: corpo.erro ?? `a rota respondeu ${resposta.status}` };
    }
    return { ok: true, mensagem: "" };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}
