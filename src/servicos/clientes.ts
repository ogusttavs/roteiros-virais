import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import {
  briefings,
  clientes,
  nichos,
  user,
  type Cliente,
  type PerfisCliente,
  type TemaPreferido,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hojeISO } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";

/** Nome com mensagem para o cliente (plataforma/CLAUDE.md, convencao de erros). */
export class ErroAcessoNegado extends Error {}

/** Erros de dado do proprio recurso cliente, sem relacao com permissao. */
export class ErroCliente extends Error {}

/**
 * Segunda camada de defesa para acoes de admin (revisao da etapa 3,
 * PROXIMO.md): confere o papel explicitamente, em vez de confiar so no
 * auth.api.createUser recusar quem nao e admin. Funcao pura, para testar
 * sem precisar de uma sessao de verdade.
 */
export function garantirSessaoAdmin(sessao: { user: { role?: string | null } } | null): void {
  if (!sessao || sessao.user.role !== "admin") {
    throw new ErroAcessoNegado("So um administrador pode fazer isso.");
  }
}

export async function clienteDoUsuario(usuarioId: string): Promise<Cliente | null> {
  const [cliente] = await db().select().from(clientes).where(eq(clientes.usuarioId, usuarioId));
  return cliente ?? null;
}

export async function clientePorId(clienteId: number): Promise<Cliente | null> {
  const [cliente] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
  return cliente ?? null;
}

export async function briefingCompleto(clienteId: number): Promise<boolean> {
  const [briefing] = await db()
    .select({ completo: briefings.completo })
    .from(briefings)
    .where(eq(briefings.clienteId, clienteId));
  return briefing?.completo ?? false;
}

/**
 * Confere que o cliente pedido e o mesmo da sessao. Dado de um cliente nunca
 * aparece para outro (plataforma/CLAUDE.md).
 */
export async function garantirClientePermitido(
  clienteIdPedido: number,
  usuarioId: string,
): Promise<Cliente> {
  const cliente = await clienteDoUsuario(usuarioId);
  if (!cliente || cliente.id !== clienteIdPedido) {
    throw new ErroAcessoNegado("Este recurso pertence a outro cliente.");
  }
  return cliente;
}

/**
 * O cliente da sessao atual, direto, sem receber nenhum id de fora. Usada
 * pelas Server Actions do painel (/comecar, /briefing): como o clienteId
 * nunca vem do cliente da requisicao, nao existe caminho para uma sessao
 * ler ou gravar o briefing de outro cliente por essas rotas (isolamento no
 * nivel de rota, plano de execucao etapa 5).
 */
export async function clienteDaSessaoAtual(): Promise<Cliente> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    throw new ErroAcessoNegado("Nenhum cliente encontrado para esta sessao.");
  }
  return cliente;
}

export type ClienteComNichoENome = {
  id: number;
  nome: string;
  email: string;
  nichoNome: string | null;
  ativo: boolean;
};

/** Lista para /admin/clientes (brief-frontend.md, 6.10). */
export async function listarClientes(): Promise<ClienteComNichoENome[]> {
  return db()
    .select({
      id: clientes.id,
      nome: clientes.nome,
      email: user.email,
      nichoNome: nichos.nome,
      ativo: clientes.ativo,
    })
    .from(clientes)
    .innerJoin(user, eq(user.id, clientes.usuarioId))
    .leftJoin(nichos, eq(nichos.id, clientes.nichoId))
    .orderBy(clientes.criadoEm);
}

/**
 * O admin cria o usuario (sem senha, o cliente entra por link magico), o
 * registro de cliente, e ja manda o convite. auth.api.createUser e
 * signInMagicLink precisam dos headers da requisicao para saber quem esta
 * autenticado (o admin) e para onde mandar o e-mail.
 */
export async function criarClienteEConvidar(dados: {
  nome: string;
  email: string;
  nichoId: number;
}): Promise<Cliente> {
  const cabecalhos = await headers();

  const { user: usuarioCriado } = await auth.api.createUser({
    body: {
      email: dados.email,
      name: dados.nome,
      /**
       * O better-auth so infere papel customizado no tipo quando a opcao
       * roles (controle de acesso) esta configurada; sem ela o tipo fica
       * "user" | "admin" mesmo com defaultRole: "cliente" em auth.ts. Em
       * tempo de execucao e so uma string na coluna role.
       */
      role: "cliente" as unknown as "admin",
    },
    headers: cabecalhos,
  });

  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId: usuarioCriado.id,
      nome: dados.nome,
      nichoId: dados.nichoId,
    })
    .returning();

  await auth.api.signInMagicLink({
    body: { email: dados.email, callbackURL: "/comecar" },
    headers: cabecalhos,
  });

  return cliente;
}

/** Nichos ativos para a lista de ramo em /comecar (briefing-e-rubricas.md, secao 1). */
export async function listarNichosAtivos(): Promise<{ id: number; nome: string }[]> {
  return db()
    .select({ id: nichos.id, nome: nichos.nome })
    .from(nichos)
    .where(eq(nichos.ativo, true))
    .orderBy(nichos.nome);
}

/**
 * Dados fixos do briefing (briefing-e-rubricas.md, secao 1; brief-frontend.md,
 * 6.2): sem nota, so validacao. "Ramo" e um nicho da lista (nichoId) ou, se o
 * cliente escolher "outro", um texto livre em ramoOutro; os dois nunca
 * coexistem. Perfis, bairro e quem grava sao opcionais aqui e continuam
 * editaveis depois em /conta.
 */
export const dadosFixosSchema = z
  .object({
    nome: z.string().trim().min(1),
    cidade: z.string().trim().min(1),
    bairro: z.string().trim().optional(),
    nichoId: z.number().int().positive().optional(),
    ramoOutro: z.string().trim().optional(),
    persona: z.enum(["negocio", "criador"]),
    perfis: z
      .object({
        instagram: z.string().trim().optional(),
        tiktok: z.string().trim().optional(),
        youtube: z.string().trim().optional(),
      })
      .optional(),
    quemGrava: z.enum(["propria_pessoa", "pessoa_e_equipe"]).optional(),
  })
  .refine((dados) => Boolean(dados.nichoId) || Boolean(dados.ramoOutro?.trim()), {
    message: "escolha um ramo da lista ou descreva o seu",
    path: ["ramo"],
  });

export type DadosFixos = z.infer<typeof dadosFixosSchema>;

export async function salvarDadosFixos(clienteId: number, dadosBrutos: unknown): Promise<Cliente> {
  const dados = dadosFixosSchema.parse(dadosBrutos);

  const perfis: PerfisCliente = {
    instagram: dados.perfis?.instagram?.trim() || null,
    tiktok: dados.perfis?.tiktok?.trim() || null,
    youtube: dados.perfis?.youtube?.trim() || null,
  };

  const [cliente] = await db()
    .update(clientes)
    .set({
      nome: dados.nome,
      cidade: dados.cidade,
      bairro: dados.bairro?.trim() || null,
      nichoId: dados.nichoId ?? null,
      ramoOutro: dados.nichoId ? null : (dados.ramoOutro?.trim() ?? null),
      persona: dados.persona,
      perfis,
      quemGrava: dados.quemGrava ?? null,
    })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar os dados; cliente nao encontrado.");
  return cliente;
}

const perfilContaSchema = z.object({
  nome: z.string().trim().min(1),
  perfis: z.object({
    instagram: z.string().trim().optional(),
    tiktok: z.string().trim().optional(),
    youtube: z.string().trim().optional(),
  }),
  /**
   * "HH:MM" (etapa 13, ajuste 4: o navegador nao obriga o `step` de hora
   * cheia do campo, entao chega qualquer minuto). Arredondada para a hora
   * cheia anterior antes de gravar; a faixa permitida (etapa 13, ajuste 3)
   * e conferida depois do arredondamento.
   */
  horaLembrete: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora invalida"),
});

/** O tema do dia nasce as 05:30; o lembrete nao faz sentido antes disso nem tarde da noite. */
const HORA_LEMBRETE_MINIMA = "06:00";
const HORA_LEMBRETE_MAXIMA = "22:00";

function arredondarParaHoraCheia(horaMinuto: string): string {
  const [hora] = horaMinuto.split(":");
  return `${hora}:00`;
}

/**
 * /conta (etapa D, parte 2; hora do lembrete na etapa 12, faixa e
 * arredondamento na etapa 13): nome, perfis e a hora do lembrete, gravados
 * numa unica UPDATE. Diferente de salvarDadosFixos (/comecar), que exige
 * cidade e persona: a tela de conta nao mostra esses campos, entao usar
 * salvarDadosFixos aqui exigiria ler o cliente primeiro para preservar o
 * resto (uma leitura-depois-escrita sem necessidade, no mesmo tipo de
 * corrida de dado ja corrigido em src/servicos/briefing.ts).
 */
export async function salvarPerfilConta(clienteId: number, dadosBrutos: unknown): Promise<Cliente> {
  const dados = perfilContaSchema.parse(dadosBrutos);

  const horaLembrete = arredondarParaHoraCheia(dados.horaLembrete);
  if (horaLembrete < HORA_LEMBRETE_MINIMA || horaLembrete > HORA_LEMBRETE_MAXIMA) {
    throw new ErroCliente(
      `hora do lembrete fora da faixa permitida (${HORA_LEMBRETE_MINIMA} a ${HORA_LEMBRETE_MAXIMA}): ${horaLembrete}`,
    );
  }

  const perfis: PerfisCliente = {
    instagram: dados.perfis.instagram?.trim() || null,
    tiktok: dados.perfis.tiktok?.trim() || null,
    youtube: dados.perfis.youtube?.trim() || null,
  };

  const [cliente] = await db()
    .update(clientes)
    .set({ nome: dados.nome, perfis, horaLembrete })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar a conta; cliente nao encontrado.");
  return cliente;
}

const TEMAS_VALIDOS: TemaPreferido[] = ["claro", "escuro", "sistema"];

/**
 * Preferencia de tema (etapa D, parte 2, decisao 3): so o cliente logado
 * grava no banco; o admin, sem registro em `clientes`, usa so o
 * `localStorage` do navegador (nunca chega a esta funcao).
 */
export async function salvarTema(clienteId: number, tema: string): Promise<Cliente> {
  if (!TEMAS_VALIDOS.includes(tema as TemaPreferido)) {
    throw new ErroCliente(`tema invalido: ${tema}`);
  }

  const [cliente] = await db()
    .update(clientes)
    .set({ tema: tema as TemaPreferido })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar o tema; cliente nao encontrado.");
  return cliente;
}

/**
 * Mesmo "hoje" usado pelo job `lembrete` (etapa 12, decisao 5) para decidir
 * quem ja abriu o painel: comparado em data local do Brasil, nao UTC, mesmo
 * raciocinio de `hojeISO`. Compartilhada aqui para o layout do painel (que
 * grava `ultimo_acesso_em`) e o job (que le) nunca divergirem.
 */
export function acessouHoje(ultimoAcessoEm: Date | null, agora = new Date()): boolean {
  return ultimoAcessoEm !== null && hojeISO(ultimoAcessoEm) === hojeISO(agora);
}

/**
 * O layout do painel chama isto no maximo uma vez por dia por cliente
 * (etapa 12, decisao 5): confere com `acessouHoje` antes de chamar, para nao
 * gravar a cada navegacao.
 */
export async function registrarAcessoHoje(clienteId: number): Promise<void> {
  await db().update(clientes).set({ ultimoAcessoEm: new Date() }).where(eq(clientes.id, clienteId));
}

/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisao 7): quem nao
 * aceitou nao passa do layout `(completo)`.
 */
export async function aceitarTermos(clienteId: number): Promise<Cliente> {
  const [cliente] = await db()
    .update(clientes)
    .set({ aceitouTermosEm: new Date() })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel registrar o aceite; cliente nao encontrado.");
  return cliente;
}
