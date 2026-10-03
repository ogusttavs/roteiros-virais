/**
 * E38 PR 2, "o que entendemos da sua marca": o que a seção do briefing lê do banco e as quatro
 * coisas que a pessoa faz com cada item (confirmar, corrigir, tirar, desfazer). A leitura em si
 * (site, redes, IA) mora no job `src/jobs/entender-marca.ts`; as regras de junção ficam em
 * `contexto-marca-regras.ts`. Aqui só banco e o disparo do job, como todo serviço do projeto.
 *
 * Isolamento: toda função recebe o `clienteId` que a Server Action tirou da sessão, e toda escrita
 * confere `id` e `clienteId` juntos no `WHERE`, nunca o id do item sozinho (mesmo desenho de
 * `desativarRegra`, `aprendizado.ts`). Nada daqui toca em `nichos`, `contas` nem `videos`.
 *
 * Este arquivo é importado por `briefing.ts` (`perfilDoCliente`): não pode importar nenhum job que
 * volte a `briefing.ts` (o `analisar-perfil` importa `perfilDoCliente`). Só `jobs/fila`, que enfileira.
 */
import { createHash } from "node:crypto";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  type CategoriaContextoMarca,
  type Cliente,
  type EstadoItemContextoMarca,
  type FonteContextoMarca,
  type FonteDoContexto,
  type NovidadeContextoMarca,
  contextoMarca,
  contextoMarcaItens,
} from "@/db/schema";
import { config } from "@/lib/config";

import { FILAS, boss, garantirBossPronto } from "../jobs/fila";

import {
  type EstadoDaSecao,
  TAMANHO_MAXIMO_TEXTO_BRUTO_DA_PESSOA,
  TAMANHO_MAXIMO_TEXTO_DA_PESSOA,
  estadoDaSecao,
  itemVisivel,
  limparTextoDaPessoa,
  proximaLeituraParaMostrar,
  textoEmVigor,
  textoParaMostrar,
} from "./contexto-marca-regras";

export class ErroContextoMarca extends Error {}


export type ItemDaSecao = {
  id: number;
  categoria: CategoriaContextoMarca;
  origem: FonteContextoMarca;
  /** `recusado` nunca chega à tela; a tela só vê os três estados em que o item está à mostra. */
  estado: Exclude<EstadoItemContextoMarca, "recusado">;
  /** O que a tela mostra: a proposta pendente, ou o que está em vigor (confirmado ou corrigido). */
  texto: string;
  /**
   * Só quando há uma proposta nova por cima de um texto que a pessoa já tinha confirmado: o que continua
   * valendo nos roteiros até ela decidir. Sem isto a tela mostraria a proposta como se ela já valesse.
   */
  valiaAntes: string | null;
  novidade: NovidadeContextoMarca | null;
};

/** Um item que a pessoa tirou: fica numa lista à parte, para ela poder desfazer depois de recarregar a página. */
export type ItemTirado = {
  id: number;
  categoria: CategoriaContextoMarca;
  origem: FonteContextoMarca;
  texto: string;
};

export type SecaoContextoMarca = {
  estado: EstadoDaSecao;
  itens: ItemDaSecao[];
  tirados: ItemTirado[];
  /** Muda quando qualquer coisa da seção muda no servidor: a tela usa de `key` para não ficar com o estado de antes. */
  versao: string;
  fontes: FonteDoContexto[];
  /** O TikTok da marca está guardado, mas ainda não é lido (Apify suspenso). */
  tiktokGuardado: boolean;
  ultimaLeituraOkEm: Date | null;
  proximaLeituraEm: Date | null;
};

const ORDEM_CATEGORIA: Record<CategoriaContextoMarca, number> = { vende: 0, fala: 1, posta: 2, rendeu: 3 };

/** A marca tem de onde ler? Site, Instagram ou YouTube (o TikTok sozinho não conta: não é lido). */
export function marcaTemFonteParaLer(cliente: Pick<Cliente, "site" | "perfis">): boolean {
  return Boolean(cliente.site?.trim() || cliente.perfis?.instagram?.trim() || cliente.perfis?.youtube?.trim());
}

/**
 * O que a seção do briefing mostra. Ordem fixa por categoria e depois por id: um item que a
 * pessoa confirma não muda de lugar na lista (mesma regra de `regrasDoCliente`).
 */
export async function secaoDoCliente(
  cliente: Pick<Cliente, "id" | "site" | "perfis">,
  agora: Date = new Date(),
): Promise<SecaoContextoMarca> {
  const [linha] = await db().select().from(contextoMarca).where(eq(contextoMarca.clienteId, cliente.id));
  const itensDoBanco = await db()
    .select()
    .from(contextoMarcaItens)
    .where(eq(contextoMarcaItens.clienteId, cliente.id))
    .orderBy(asc(contextoMarcaItens.id));

  // As fontes que a Conta tem hoje. O que veio de uma fonte que a pessoa tirou (o site apagado, o Instagram trocado por outro) e que
  // ela nunca confirmou não é mais dela: some da tela na hora, sem esperar uma leitura (que nem acontece quando não sobrou fonte
  // nenhuma). O que ela confirmou ou corrigiu continua à vista, porque continua entrando em todo roteiro.
  const fontesDaConta = new Set<FonteContextoMarca>(
    [
      cliente.site?.trim() ? "site" : null,
      cliente.perfis?.instagram?.trim() ? "instagram" : null,
      cliente.perfis?.youtube?.trim() ? "youtube" : null,
    ].filter((fonte): fonte is FonteContextoMarca => fonte !== null),
  );

  const itens: ItemDaSecao[] = itensDoBanco
    .filter((item) => itemVisivel(item) && (item.textoConfirmado !== null || fontesDaConta.has(item.origem)))
    .map((item) => ({
      id: item.id,
      categoria: item.categoria,
      origem: item.origem,
      estado: item.estado as ItemDaSecao["estado"],
      texto: textoParaMostrar(item),
      valiaAntes: item.estado === "para_confirmar" ? item.textoConfirmado : null,
      novidade: item.novidade,
    }))
    .sort((a, b) => ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria] || a.id - b.id);

  // O que a pessoa tirou: do mais recente para o mais antigo (id alto primeiro), o texto que estava à mostra.
  const tirados: ItemTirado[] = itensDoBanco
    .filter((item) => item.estado === "recusado")
    .sort((a, b) => b.id - a.id)
    .map((item) => ({
      id: item.id,
      categoria: item.categoria,
      origem: item.origem,
      texto: item.textoConfirmado ?? item.texto,
    }));

  const ultimaLeituraOkEm = linha?.ultimaLeituraOkEm ?? null;
  const proximaLeitura = proximaLeituraParaMostrar(
    ultimaLeituraOkEm,
    linha?.proximaTentativaEm ?? null,
    config.regras.diasEntreLeituraMarca,
    agora,
  );
  const estado = estadoDaSecao({
    temFonte: marcaTemFonteParaLer(cliente),
    ultimaLeituraOkEm,
    ultimaTentativaEm: linha?.ultimaTentativaEm ?? null,
    lendoDesde: linha?.lendoDesde ?? null,
    agora,
  });
  const fontes = linha?.fontes ?? [];
  const versao = createHash("sha1")
    .update(
      JSON.stringify([
        estado,
        ultimaLeituraOkEm?.getTime() ?? null,
        itens.map((i) => [i.id, i.estado, i.texto, i.valiaAntes, i.novidade]),
        tirados.map((i) => [i.id, i.texto]),
        fontes.map((f) => [f.tipo, f.lida, f.motivo ?? null]),
      ]),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    estado,
    itens,
    tirados,
    versao,
    fontes,
    tiktokGuardado: Boolean(cliente.perfis?.tiktok?.trim()),
    ultimaLeituraOkEm,
    proximaLeituraEm: proximaLeitura,
  };
}

/**
 * O que chega ao perfil compilado (`perfilDoCliente`) e, por ele, a todo roteiro, tema e plano:
 * só o que a pessoa confirmou ou corrigiu e não tirou. Proposta pendente nunca entra. Ordem fixa.
 */
export async function contextoConfirmadoDoCliente(
  clienteId: number,
): Promise<{ categoria: CategoriaContextoMarca; texto: string }[]> {
  const itens = await db()
    .select()
    .from(contextoMarcaItens)
    .where(eq(contextoMarcaItens.clienteId, clienteId))
    .orderBy(asc(contextoMarcaItens.id));
  return itens
    .map((item) => ({ categoria: item.categoria, texto: textoEmVigor(item) }))
    .filter((item): item is { categoria: CategoriaContextoMarca; texto: string } => item.texto !== null)
    .sort((a, b) => ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria]);
}

/**
 * "Está certo": a proposta da IA passa a valer. Item que a pessoa tirou não se confirma. A pessoa confirma
 * o texto que VIU (`textoVisto`): se uma leitura nova trocou a proposta enquanto a página estava aberta, a
 * confirmação não vale para um texto que ela não leu, e o resultado é `"mudou"` (a tela recarrega a seção).
 */
export async function confirmarItem(
  clienteId: number,
  itemId: number,
  textoVisto: string,
): Promise<"confirmado" | "mudou"> {
  const agora = new Date();
  const [linha] = await db()
    .update(contextoMarcaItens)
    .set({
      estado: "confirmado",
      textoConfirmado: sql`${contextoMarcaItens.texto}`,
      estadoAnterior: null,
      novidade: null,
      confirmadoEm: agora,
      atualizadoEm: agora,
    })
    .where(
      and(
        eq(contextoMarcaItens.id, itemId),
        eq(contextoMarcaItens.clienteId, clienteId),
        eq(contextoMarcaItens.estado, "para_confirmar"),
        eq(contextoMarcaItens.texto, textoVisto),
      ),
    )
    .returning({ id: contextoMarcaItens.id });
  if (linha) return "confirmado";

  const [atual] = await db()
    .select({ estado: contextoMarcaItens.estado, texto: contextoMarcaItens.texto, textoConfirmado: contextoMarcaItens.textoConfirmado })
    .from(contextoMarcaItens)
    .where(and(eq(contextoMarcaItens.id, itemId), eq(contextoMarcaItens.clienteId, clienteId)));
  if (!atual || atual.estado === "recusado") throw new ErroContextoMarca("item nao encontrado.");
  // Duplo toque: já está confirmado com o mesmo texto que ela viu, conta como feito.
  if (atual.estado !== "para_confirmar" && (atual.textoConfirmado === textoVisto || atual.texto === textoVisto)) {
    return "confirmado";
  }
  return "mudou";
}

/** "Corrigir": o texto da pessoa vale no lugar do da IA, e a IA nunca o sobrescreve. */
export async function corrigirItem(clienteId: number, itemId: number, textoDaPessoa: string): Promise<void> {
  // Passar do teto é erro, nunca corte: o texto dela entra em todo roteiro como ela escreveu. O tamanho cru
  // se confere antes de qualquer tratamento (um texto enorme nem é examinado).
  if (textoDaPessoa.length > TAMANHO_MAXIMO_TEXTO_BRUTO_DA_PESSOA) throw new ErroContextoMarca("o texto está longo demais.");
  const texto = limparTextoDaPessoa(textoDaPessoa);
  if (texto === "") throw new ErroContextoMarca("escreva o que está certo.");
  if (texto.length > TAMANHO_MAXIMO_TEXTO_DA_PESSOA) throw new ErroContextoMarca("o texto está longo demais.");
  const agora = new Date();
  const [linha] = await db()
    .update(contextoMarcaItens)
    .set({
      estado: "corrigido",
      textoConfirmado: texto,
      estadoAnterior: null,
      novidade: null,
      confirmadoEm: agora,
      atualizadoEm: agora,
    })
    .where(
      and(
        eq(contextoMarcaItens.id, itemId),
        eq(contextoMarcaItens.clienteId, clienteId),
        ne(contextoMarcaItens.estado, "recusado"),
      ),
    )
    .returning({ id: contextoMarcaItens.id });
  if (!linha) throw new ErroContextoMarca("item nao encontrado.");
}

/** "Tirar": o item some e nunca mais volta, nem com outras palavras. "Desfazer" devolve o que era. */
export async function tirarItem(clienteId: number, itemId: number): Promise<void> {
  const [atual] = await db()
    .select({ estado: contextoMarcaItens.estado })
    .from(contextoMarcaItens)
    .where(and(eq(contextoMarcaItens.id, itemId), eq(contextoMarcaItens.clienteId, clienteId)));
  if (!atual) throw new ErroContextoMarca("item nao encontrado.");
  if (atual.estado === "recusado") return;
  const agora = new Date();
  await db()
    .update(contextoMarcaItens)
    .set({ estado: "recusado", estadoAnterior: atual.estado, novidade: null, atualizadoEm: agora })
    .where(and(eq(contextoMarcaItens.id, itemId), eq(contextoMarcaItens.clienteId, clienteId)));
}

export async function desfazerTirarItem(clienteId: number, itemId: number): Promise<void> {
  const [atual] = await db()
    .select({ estadoAnterior: contextoMarcaItens.estadoAnterior, estado: contextoMarcaItens.estado })
    .from(contextoMarcaItens)
    .where(and(eq(contextoMarcaItens.id, itemId), eq(contextoMarcaItens.clienteId, clienteId)));
  if (!atual) throw new ErroContextoMarca("item nao encontrado.");
  if (atual.estado !== "recusado") return;
  await db()
    .update(contextoMarcaItens)
    .set({ estado: atual.estadoAnterior ?? "para_confirmar", estadoAnterior: null, atualizadoEm: new Date() })
    .where(and(eq(contextoMarcaItens.id, itemId), eq(contextoMarcaItens.clienteId, clienteId)));
}

/**
 * Dispara a leitura da marca sem esperar (mesmo desenho de `enfileirarAnaliseDaPropriaMarca`: ler o
 * site e as redes não pode prender uma ação da pessoa).
 *
 * Por evento (a pessoa salvou o site ou um perfil), SEM janela de deduplicação do pg-boss: a janela é
 * por balde de tempo e descartaria o segundo "Salvar" (a pessoa corrige o endereço trinta segundos
 * depois e a leitura corrigida nunca rodaria). O próprio job já cuida do excesso: a trava por marca, o
 * intervalo mínimo entre leituras por evento (que reenfileira uma só para depois) e o hash das fontes
 * (que não gasta IA quando nada mudou). Mensal e manual, e a reenfileirada ("depois"), têm janela.
 * Devolve `false` quando o pg-boss deduplicou.
 */
export async function enfileirarEntenderMarca(
  clienteId: number,
  origem: "evento" | "mensal" | "manual",
  opcoes: { janelaSegundos?: number; depoisDeSegundos?: number; chave?: string } = {},
): Promise<boolean> {
  await garantirBossPronto();
  const comJanela = origem !== "evento" || opcoes.chave !== undefined;
  const id = await boss().send(
    FILAS.entenderMarca,
    { clienteId, origem },
    {
      ...(comJanela
        ? { singletonKey: opcoes.chave ?? `marca-${clienteId}`, singletonSeconds: opcoes.janelaSegundos ?? 60 }
        : {}),
      ...(opcoes.depoisDeSegundos ? { startAfter: opcoes.depoisDeSegundos } : {}),
    },
  );
  return id !== null;
}
