"use server";

import { revalidatePath } from "next/cache";

import type { Cliente } from "@/db/schema";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { sessaoAtual } from "@/lib/sessao";
import { criarMarcaDoCatalogo, ErroCliente, garantirSessaoAdmin } from "@/servicos/clientes";
import { ErroNicho } from "@/servicos/nichos";
import { ErroLimiteDeSetores } from "@/servicos/ramos";
import { textosRamo } from "@/textos/ramo";

/**
 * Defesa em duas camadas (revisao da etapa 3, PROXIMO.md): a Server Action
 * confere o papel explicitamente, sem confiar so no auth.api.createUser
 * recusar quem nao e admin. V12b, item 2: cria so a marca, sem ninguem; a
 * pessoa entra depois, dentro dela, por `darAcessoAction`.
 */
export async function criarMarcaAction(dados: {
  nome: string;
  /** O ramo do catálogo (o `slug`), ou nulo quando o admin escreveu o ramo à mão (`ramoOutro`). */
  ramoSlug: string | null;
  ramoOutro: string | null;
  tipo: "negocio" | "pessoa";
  plano: "padrao" | "sem_limite";
}): Promise<ResultadoAcao<Cliente>> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const marca = await criarMarcaDoCatalogo(dados);
    revalidatePath("/admin/clientes");
    revalidatePath("/admin/nichos");
    return { ok: true, dado: marca };
  } catch (erro) {
    if (erro instanceof ErroLimiteDeSetores) return { ok: false, erro: textosRamo.limiteDeRamosNovos };
    if (erro instanceof ErroCliente || erro instanceof ErroNicho) return { ok: false, erro: erro.message };
    throw erro;
  }
}
