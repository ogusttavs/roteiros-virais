"use server";

import { revalidatePath } from "next/cache";

import { virarContaDoSetor } from "@/jobs/analisar-perfil";
import { contagemElegivelSemFala, type EfeitoVideoSemFala } from "@/jobs/extrair-sem-fala";
import { FILAS } from "@/jobs/fila";
import { sessaoAtual } from "@/lib/sessao";
import { garantirSessaoAdmin } from "@/servicos/clientes";
import {
  aceitarTermoSugerido,
  adicionarContasSemente,
  alternarAtivoNicho,
  atualizarNicho,
  atualizarRegua,
  criarNicho,
  type DadosRegua,
  ErroNicho,
  tirarConta,
} from "@/servicos/nichos";
import { conferirPedidoAberto, encaixarPedido, resolverPedidoComSetorNovo } from "@/servicos/pedidos-de-ramo";
import { efeitoPiso, type EfeitoPiso } from "@/servicos/pesquisa";

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

/**
 * E45 PR 2, "encaixar em um que existe": a marca do pedido vai para o setor do ramo do catálogo que o admin escolheu (que nasce ou volta, se
 * preciso; o teto de setores novos do dia vale e vira a mensagem), o pedido fecha, e o setor provisório desliga se ficou sem marca. O número
 * ao lado de "Nichos" (no layout) se atualiza com o `revalidatePath` do layout inteiro.
 */
export async function encaixarPedidoAction(pedidoId: number, slugDoRamo: string): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await encaixarPedido(pedidoId, slugDoRamo);
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

/**
 * E45 PR 2, "criar ramo": o admin cria o setor novo (a mesma tela de sempre, já preenchida com o que a pessoa escreveu), a marca vai para ele e
 * o pedido fecha. Confere ANTES de criar que o pedido ainda está aberto (um setor criado sem pedido para fechar seria lixo).
 */
export async function criarRamoDoPedidoAction(
  pedidoId: number,
  dados: { nome: string; descricao: string; termosBruto: string },
): Promise<Resultado & { slug?: string }> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await conferirPedidoAberto(pedidoId);
    const nicho = await criarNicho(dados);
    await resolverPedidoComSetorNovo(pedidoId, nicho.id);
    revalidatePath("/admin", "layout");
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

/** "Pesquisar o mercado de novo" (M2, item 1): enfileira o job pesquisa-de-setor para este setor. */
export async function pesquisarMercadoAction(nichoId: number): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  const resultado = await dispararJobAction(FILAS.pesquisaDeSetor, { nichoId });
  return { ok: resultado.ok, mensagem: resultado.duplicado ? "ja tem uma pesquisa rodando para este setor." : resultado.mensagem };
}

/** "Tirar" uma conta semente (M2, item 3): nao volta a ser sugerida pela pesquisa de setor. */
export async function tirarContaAction(contaId: number, slug: string): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await tirarConta(contaId);
    revalidatePath(`/admin/nichos/${slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

/** Aceita um termo ou hashtag que a pesquisa de setor sugeriu (M2, item 6). */
export async function aceitarTermoSugeridoAction(nichoId: number, slug: string, termo: string): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await aceitarTermoSugerido(nichoId, termo);
    revalidatePath(`/admin/nichos/${slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

/** M3: os três ajustes por setor, no admin do setor. "voltar ao padrão" manda o campo como `null`. */
export async function atualizarReguaAction(nichoId: number, slug: string, dados: DadosRegua): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await atualizarRegua(nichoId, dados);
    revalidatePath(`/admin/nichos/${slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: mensagemDeErro(erro) };
  }
}

/**
 * M3, item 3: "ao mexer num dos três, a tela diz quantos vídeos do setor passariam nos últimos 7
 * e 30 dias com o valor novo". Só o piso muda uma contagem de referências de verdade; "vídeo sem
 * fala vale" muda uma contagem de elegíveis para a leitura por imagem (não é a mesma pergunta: a
 * proporção de vídeo brasileiro não tem uma contagem própria, ela só redistribui o que já passa).
 */
export async function preverEfeitoReguaAction(
  nichoId: number,
  pisoViews: number,
): Promise<EfeitoPiso & EfeitoVideoSemFala> {
  garantirSessaoAdmin(await sessaoAtual());

  const [piso, semFala] = await Promise.all([efeitoPiso(nichoId, pisoViews), contagemElegivelSemFala(nichoId, pisoViews)]);
  return { ...piso, ...semFala };
}

/** E38, parte 3: o perfil indicado por um cliente que já passou na régua vira conta vigiada do setor. */
export async function virarContaDoSetorAction(perfilAnalisadoId: number, slug: string): Promise<Resultado> {
  garantirSessaoAdmin(await sessaoAtual());

  try {
    await virarContaDoSetor(perfilAnalisadoId);
    revalidatePath(`/admin/nichos/${slug}`);
    return { ok: true };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : "nao foi possivel virar conta agora. Tente de novo." };
  }
}
