"use server";

import { revalidatePath } from "next/cache";

import { FILAS } from "@/jobs/fila";
import { sessaoAtual } from "@/lib/sessao";
import { garantirSessaoAdmin } from "@/servicos/clientes";
import {
  adicionarContasSemente,
  alternarAtivoNicho,
  atualizarNicho,
  criarNicho,
  ErroNicho,
} from "@/servicos/nichos";

import { dispararJobAction } from "../_jobs/acoes";

type Resultado = { ok: boolean; mensagem?: string };

function mensagemDeErro(erro: unknown): string {
  return erro instanceof ErroNicho
    ? erro.message
    : "nao foi possivel salvar; confira os dados e tente de novo.";
}

export async function criarNichoAction(dados: {
  nome: string;
  descricao: string;
  termosBruto: string;
}): Promise<Resultado & { slug?: string }> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const nicho = await criarNicho(dados);
    revalidatePath("/admin/nichos");
    return { ok: true, slug: nicho.slug };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

export async function atualizarNichoAction(
  id: number,
  dados: { nome: string; descricao: string; termosBruto: string },
): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const nicho = await atualizarNicho(id, dados);
    revalidatePath("/admin/nichos");
    revalidatePath(`/admin/nichos/${nicho.slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

export async function alternarAtivoNichoAction(id: number, ativo: boolean): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const nicho = await alternarAtivoNicho(id, ativo);
    revalidatePath("/admin/nichos");
    revalidatePath(`/admin/nichos/${nicho.slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

export async function adicionarContasSementeAction(
  nichoId: number,
  slug: string,
  urlsBruto: string,
): Promise<Resultado & { quantidade?: number }> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    const contasCriadas = await adicionarContasSemente(nichoId, urlsBruto);
    revalidatePath(`/admin/nichos/${slug}`);
    return { ok: true, quantidade: contasCriadas.length };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

/**
 * "Coletar agora" (decisao 4 do PROXIMO.md; M1, item 4: acrescenta transcricao e analise
 * imediata a este caminho, para o setor novo ficar pronto em minutos): os cinco jobs, um de cada
 * vez, na ordem YouTube, Apify, noticias, transcricao, analise imediata, e devolve na hora (nao
 * espera os jobs terminarem; quem processa e o worker, e cada job so comeca depois que o worker
 * pegar o anterior na fila, entao a ordem aqui e a ordem em que eles tendem a rodar). Cada
 * chamada passa pela mesma rota autenticada de sempre (`dispararJobAction`), so que com
 * `{ nichoId }` no corpo, que a rota usa tanto para escopar o job quanto para recusar duplicar
 * um pendente do mesmo nicho. `extrairAgora` sozinho ja pula setor com 20 ou mais vídeos
 * analisados (item 1), entao dispara-lo aqui e seguro mesmo depois que o setor deixa de ser novo.
 */
export async function coletarAgoraAction(
  nichoId: number,
): Promise<{ ok: boolean; detalhes: { job: string; ok: boolean; mensagem: string; duplicado?: boolean }[] }> {
  garantirSessaoAdmin(await sessaoAtual());

  const ordem = [FILAS.coletaYoutube, FILAS.coletaApify, FILAS.coletaNoticias, FILAS.transcrever, FILAS.extrairAgora];
  const detalhes: { job: string; ok: boolean; mensagem: string; duplicado?: boolean }[] = [];

  for (const job of ordem) {
    const resultado = await dispararJobAction(job, { nichoId });
    detalhes.push({ job, ok: resultado.ok, mensagem: resultado.mensagem, duplicado: resultado.duplicado });
  }

  return { ok: detalhes.every((d) => d.ok), detalhes };
}
