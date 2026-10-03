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
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

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
  TAMANHO_MAXIMO_TEXTO_DA_PESSOA,
  estadoDaSecao,
  itemVisivel,
  limparTextoDoItem,
  proximaLeituraEm,
  textoEmVigor,
  textoParaMostrar,
} from "./contexto-marca-regras";

export class ErroContextoMarca extends Error {}

/** O item é desta marca e está num dos estados esperados; senão, erro (nunca vaza que o id existe em outra marca). */
async function garantirItemDaMarca(
  clienteId: number,
  itemId: number,
  estados: EstadoItemContextoMarca[],
): Promise<void> {
  const [linha] = await db()
    .select({ id: contextoMarcaItens.id })
    .from(contextoMarcaItens)
    .where(
      and(
        eq(contextoMarcaItens.id, itemId),
        eq(contextoMarcaItens.clienteId, clienteId),
        inArray(contextoMarcaItens.estado, estados),
      ),
    );
  if (!linha) throw new ErroContextoMarca("item nao encontrado.");
}

export type ItemDaSecao = {
  id: number;
  categoria: CategoriaContextoMarca;
  origem: FonteContextoMarca;
  /** `recusado` nunca chega à tela; a tela só vê os três estados em que o item está à mostra. */
  estado: Exclude<EstadoItemContextoMarca, "recusado">;
  /** O que a tela mostra: a proposta pendente, ou o que está em vigor (confirmado ou corrigido). */
  texto: string;
  novidade: NovidadeContextoMarca | null;
};

export type SecaoContextoMarca = {
  estado: EstadoDaSecao;
  itens: ItemDaSecao[];
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

  const itens: ItemDaSecao[] = itensDoBanco
    .filter(itemVisivel)
    .map((item) => ({
      id: item.id,
      categoria: item.categoria,
      origem: item.origem,
      estado: item.estado as ItemDaSecao["estado"],
      texto: textoParaMostrar(item),
      novidade: item.novidade,
    }))
    .sort((a, b) => ORDEM_CATEGORIA[a.categoria] - ORDEM_CATEGORIA[b.categoria] || a.id - b.id);

  return {
    estado: estadoDaSecao({
      temFonte: marcaTemFonteParaLer(cliente),
      ultimaLeituraOkEm: linha?.ultimaLeituraOkEm ?? null,
      ultimaTentativaEm: linha?.ultimaTentativaEm ?? null,
      lendoDesde: linha?.lendoDesde ?? null,
      agora,
    }),
    itens,
    fontes: linha?.fontes ?? [],
    tiktokGuardado: Boolean(cliente.perfis?.tiktok?.trim()),
    ultimaLeituraOkEm: linha?.ultimaLeituraOkEm ?? null,
    proximaLeituraEm: proximaLeituraEm(linha?.ultimaLeituraOkEm ?? null, config.regras.diasEntreLeituraMarca),
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

/** "Está certo": a proposta da IA passa a valer. Item que a pessoa tirou não se confirma. */
export async function confirmarItem(clienteId: number, itemId: number): Promise<void> {
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
      ),
    )
    .returning({ id: contextoMarcaItens.id });
  if (!linha) {
    // Já confirmado (duplo toque) conta como feito; outro estado ou outra marca, não.
    await garantirItemDaMarca(clienteId, itemId, ["confirmado", "corrigido"]);
  }
}

/** "Corrigir": o texto da pessoa vale no lugar do da IA, e a IA nunca o sobrescreve. */
export async function corrigirItem(clienteId: number, itemId: number, textoDaPessoa: string): Promise<void> {
  // Um a mais que o teto: a limpeza corta no limite que recebe, e passar do teto aqui é erro, não corte.
  const texto = limparTextoDoItem(textoDaPessoa, TAMANHO_MAXIMO_TEXTO_DA_PESSOA + 1);
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
 * site e as redes não pode prender uma ação da pessoa). Uma por marca por janela: dois toques em
 * "Salvar" seguidos viram um job só. Devolve `false` quando o pg-boss deduplicou.
 */
export async function enfileirarEntenderMarca(
  clienteId: number,
  origem: "evento" | "mensal" | "manual",
  opcoes: { janelaSegundos?: number; depoisDeSegundos?: number; chave?: string } = {},
): Promise<boolean> {
  await garantirBossPronto();
  const id = await boss().send(
    FILAS.entenderMarca,
    { clienteId, origem },
    {
      singletonKey: opcoes.chave ?? `marca-${clienteId}`,
      singletonSeconds: opcoes.janelaSegundos ?? 60,
      ...(opcoes.depoisDeSegundos ? { startAfter: opcoes.depoisDeSegundos } : {}),
    },
  );
  return id !== null;
}
