import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import {
  account,
  briefings,
  clientes,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  user,
  type Cliente,
  type PapelMarca,
  type PerfisCliente,
  type TemaPreferido,
  type TipoMarca,
} from "@/db/schema";
import { auth } from "@/lib/auth";
import { hojeISO } from "@/lib/config";
import {
  lerClienteIdDoCookie,
  NOME_COOKIE_MARCA_ATIVA,
  OPCOES_COOKIE_MARCA_ATIVA,
  valorCookieMarcaAtiva,
} from "@/lib/marca-ativa";
import { gerarSenhaLegivel } from "@/lib/senha-legivel";
import { sessaoAtual } from "@/lib/sessao";
import { resolverMetaIgId } from "@/servicos/meta-ig-cliente";
import { textosAdmin } from "@/textos/admin";

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
 * Todas as marcas de que o usuario e membro (V3, item 1, escopo 4.13),
 * ordenadas por nome: a lista "Suas marcas" da casca e da folha de troca.
 */
export async function marcasDoUsuario(usuarioId: string): Promise<Cliente[]> {
  const linhas = await db()
    .select({ cliente: clientes })
    .from(membrosMarca)
    .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
    .where(eq(membrosMarca.usuarioId, usuarioId))
    .orderBy(clientes.nome);
  return linhas.map((l) => l.cliente);
}

/** A marca de acesso mais recente entre as que o usuario pertence, para quando o cookie nao serve. */
function marcaPadrao(marcas: Cliente[]): Cliente {
  return [...marcas].sort((a, b) => {
    const acessoA = a.ultimoAcessoEm?.getTime() ?? 0;
    const acessoB = b.ultimoAcessoEm?.getTime() ?? 0;
    if (acessoA !== acessoB) return acessoB - acessoA;
    return b.criadoEm.getTime() - a.criadoEm.getTime();
  })[0];
}

/**
 * Resolve a marca ativa entre as que o usuario ja pertence (V3, item 2): o
 * cookie `marca_ativa` quando aponta para uma delas, senao a de acesso mais
 * recente, regravando o cookie nesse caso. Cookie adulterado, com id de
 * marca que o usuario nao e membro, cai na mesma regra do "senao": o cookie
 * nunca concede pertencimento a marca nenhuma, so escolhe entre as que a
 * consulta acima ja provou que sao do usuario.
 *
 * `cookies()` (leitura ou gravacao) so funciona dentro de uma requisicao do
 * Next.js; `.set` alem disso so dentro de uma Server Action ou Route
 * Handler. Chamada de fora (Server Component, job, script, teste de
 * integracao que nao passa por uma Server Action de verdade), os dois
 * try/catch abaixo engolem o erro: sem cookie para ler nem gravar, a marca
 * padrao decide sozinha, e a proxima Server Action (ou a troca de marca)
 * regrava o cookie normalmente.
 */
async function resolverMarcaAtiva(marcas: Cliente[]): Promise<Cliente | null> {
  if (marcas.length === 0) return null;

  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    cookieStore = await cookies();
  } catch {
    // Fora de uma requisicao do Next.js; ver comentario da funcao.
  }

  const clienteIdDoCookie = cookieStore
    ? lerClienteIdDoCookie(cookieStore.get(NOME_COOKIE_MARCA_ATIVA)?.value)
    : null;
  const marcaDoCookie = clienteIdDoCookie !== null ? marcas.find((m) => m.id === clienteIdDoCookie) : undefined;
  if (marcaDoCookie) return marcaDoCookie;

  const padrao = marcaPadrao(marcas);
  try {
    cookieStore?.set(NOME_COOKIE_MARCA_ATIVA, valorCookieMarcaAtiva(padrao.id), OPCOES_COOKIE_MARCA_ATIVA);
  } catch {
    // Server Component nao pode gravar cookie; ver comentario da funcao.
  }
  return padrao;
}

/**
 * A marca ativa do usuario, para Server Components (paginas): `null` quando
 * ele nao e membro de marca nenhuma. Substitui `clienteDoUsuario` (V3, item
 * 2: "um cliente por usuario" deixou de existir).
 */
export async function clienteAtivoDoUsuario(usuarioId: string): Promise<Cliente | null> {
  const marcas = await marcasDoUsuario(usuarioId);
  return resolverMarcaAtiva(marcas);
}

/**
 * Confere que o usuario e membro desta marca antes de qualquer acao sobre
 * ela (troca de marca, dar/tirar acesso). Nunca abre marca de que o usuario
 * nao e membro, nem com o id na mao (escopo 4.13, teste de isolamento).
 */
export async function garantirMembroDaMarca(usuarioId: string, clienteId: number): Promise<Cliente> {
  const [linha] = await db()
    .select({ cliente: clientes })
    .from(membrosMarca)
    .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  if (!linha) {
    throw new ErroAcessoNegado("Esta marca pertence a outra pessoa.");
  }
  return linha.cliente;
}

/**
 * Confere que o recurso pedido pertence a uma marca de que o usuario e
 * membro. Dado de uma marca nunca aparece para quem nao tem acesso a ela
 * (plataforma/CLAUDE.md).
 */
export async function garantirClientePermitido(clienteIdPedido: number, usuarioId: string): Promise<Cliente> {
  return garantirMembroDaMarca(usuarioId, clienteIdPedido);
}

/**
 * A marca ativa da sessao atual, direto, sem receber nenhum id de fora.
 * Usada pelas Server Actions do painel (/comecar, /briefing, etc): como o
 * clienteId nunca vem do cliente da requisicao, nao existe caminho para uma
 * sessao ler ou gravar o de outra marca por essas rotas (isolamento no
 * nivel de rota, plano de execucao etapa 5; V3, item 2: entre as marcas que
 * o usuario pertence, nunca so por um id que ele mandou).
 */
export async function clienteDaSessaoAtual(): Promise<Cliente> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) {
    throw new ErroAcessoNegado("Nenhuma marca encontrada para esta sessao.");
  }
  return cliente;
}

/**
 * Troca a marca ativa da sessao (V3, item 2), gravando o cookie assinado.
 * So funciona chamada de dentro de uma Server Action de verdade
 * (`cookies().set` exige isso; ver `resolverMarcaAtiva`).
 */
export async function trocarMarca(usuarioId: string, clienteId: number): Promise<Cliente> {
  const cliente = await garantirMembroDaMarca(usuarioId, clienteId);
  const cookieStore = await cookies();
  cookieStore.set(NOME_COOKIE_MARCA_ATIVA, valorCookieMarcaAtiva(clienteId), OPCOES_COOKIE_MARCA_ATIVA);
  return cliente;
}

export type MembroDaMarca = { usuarioId: string; nome: string; email: string; papel: PapelMarca };

/**
 * "Quem tem acesso a esta marca" (V3, item 4 e item 5): o dono primeiro,
 * depois por nome. So leitura em Conta (o cliente ve quem mais entra nesta
 * marca); o admin usa a mesma consulta para dar/tirar acesso (item 5).
 */
export async function membrosDaMarca(clienteId: number): Promise<MembroDaMarca[]> {
  const linhas = await db()
    .select({ usuarioId: user.id, nome: user.name, email: user.email, papel: membrosMarca.papel })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .where(eq(membrosMarca.clienteId, clienteId));
  return linhas.sort((a, b) => {
    if (a.papel !== b.papel) return a.papel === "dono" ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
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
 * "Sem nome ainda" (V3, item 5, dúvida 8 do BRIEF.md): quem ganha acesso so
 * pelo e-mail (`darAcesso`, sem campo de nome na folha) começa assim; o
 * nome de verdade é a própria pessoa quem põe, em Conta, no primeiro
 * acesso. Comparado por igualdade exata na lista do admin, para mostrar a
 * etiqueta "não entrou ainda" em vez do nome.
 */
export const NOME_SEM_NOME_AINDA = "Sem nome ainda";

/**
 * Cria o usuario e a credencial com senha gerada (V3, item 5): mesmo padrao
 * de `criarUsuarioComSenha` em `scripts/semear.ts` e `scripts/criar-admin.ts`
 * (insert direto, nao `auth.api.createUser`, que nao aceita senha pronta
 * fora do fluxo de signup completo).
 */
async function criarUsuarioComSenhaGerada(email: string, nome: string): Promise<{ usuarioId: string; senha: string }> {
  const usuarioId = randomUUID();
  const senha = gerarSenhaLegivel();
  await db()
    .insert(user)
    .values({ id: usuarioId, name: nome, email, emailVerified: false, role: "cliente" as unknown as "admin" });
  await db()
    .insert(account)
    .values({
      id: `${usuarioId}-credential`,
      issuer: "local:credential",
      accountId: usuarioId,
      providerId: "credential",
      userId: usuarioId,
      password: await hashPassword(senha),
    });
  return { usuarioId, senha };
}

/**
 * Manda o convite por e-mail (link mágico, o "clique no link do e-mail" da
 * folha "Convite mandado"); bônus sobre a senha, que já resolve o acesso
 * sozinha, então uma falha aqui não derruba a ação inteira.
 */
async function mandarConviteMagico(email: string): Promise<void> {
  const cabecalhos = await headers();
  await auth.api
    .signInMagicLink({ body: { email, callbackURL: "/comecar" }, headers: cabecalhos })
    .catch(() => {});
}

export type ResultadoCriarCliente =
  | { tipo: "jaTinhaLogin"; cliente: Cliente }
  | { tipo: "convite"; cliente: Cliente; senha: string };

/**
 * "Convidar cliente" (uma marca nova): e-mail que já entra no painel segue
 * a regra de "dar acesso" (a marca nasce e a pessoa entra direto, sem senha
 * nova, dúvida 9 do BRIEF.md); e-mail novo ganha usuário com senha gerada e
 * o convite por e-mail. Sempre dono da marca nova.
 */
export async function criarClienteEConvidar(dados: {
  nome: string;
  email: string;
  nichoId: number;
  /** V9a, item 4: o admin escolhe ao criar a marca; "negocio" é o padrão, sem tela nova. */
  tipo?: TipoMarca;
}): Promise<ResultadoCriarCliente> {
  const tipo = dados.tipo ?? "negocio";
  const [usuarioExistente] = await db().select().from(user).where(eq(user.email, dados.email));

  if (usuarioExistente) {
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId: usuarioExistente.id, nome: dados.nome, nichoId: dados.nichoId, tipo })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId: usuarioExistente.id, clienteId: cliente.id, papel: "dono" });
    return { tipo: "jaTinhaLogin", cliente };
  }

  const { usuarioId, senha } = await criarUsuarioComSenhaGerada(dados.email, dados.nome);
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: dados.nome, nichoId: dados.nichoId, tipo })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: cliente.id, papel: "dono" });
  await mandarConviteMagico(dados.email);

  return { tipo: "convite", cliente, senha };
}

export type ResultadoDarAcesso = { tipo: "jaTinhaLogin"; nome: string } | { tipo: "convite"; senha: string };

/**
 * "Dar acesso" a uma marca que já existe (V3, item 5, AdminCliente.dc.html):
 * só o e-mail. Quem já entra no painel ganha a marca na hora, sem senha
 * nova; quem não tem login recebe usuário com senha gerada e "Sem nome
 * ainda" até se apresentar em Conta.
 */
export async function darAcesso(clienteId: number, email: string): Promise<ResultadoDarAcesso> {
  const [usuarioExistente] = await db().select().from(user).where(eq(user.email, email));

  if (usuarioExistente) {
    const [jaMembro] = await db()
      .select({ id: membrosMarca.id })
      .from(membrosMarca)
      .where(and(eq(membrosMarca.usuarioId, usuarioExistente.id), eq(membrosMarca.clienteId, clienteId)));
    if (jaMembro) {
      throw new ErroCliente(textosAdmin.acessos.erroJaTemAcesso);
    }
    await db().insert(membrosMarca).values({ usuarioId: usuarioExistente.id, clienteId, papel: "membro" });
    return { tipo: "jaTinhaLogin", nome: usuarioExistente.name };
  }

  const { usuarioId, senha } = await criarUsuarioComSenhaGerada(email, NOME_SEM_NOME_AINDA);
  await db().insert(membrosMarca).values({ usuarioId, clienteId, papel: "membro" });
  await mandarConviteMagico(email);

  return { tipo: "convite", senha };
}

/**
 * "Gerar senha nova" por pessoa (V3, item 5): substitui a credencial atual;
 * so entra pela nova a partir de agora. Cria a credencial se por algum
 * motivo nao existir (nunca deveria acontecer para quem entrou por aqui).
 */
export async function gerarSenhaNova(usuarioId: string): Promise<string> {
  const senha = gerarSenhaLegivel();
  const senhaHash = await hashPassword(senha);
  const [contaCredencial] = await db()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, usuarioId), eq(account.providerId, "credential")));

  if (contaCredencial) {
    await db().update(account).set({ password: senhaHash }).where(eq(account.id, contaCredencial.id));
  } else {
    await db()
      .insert(account)
      .values({
        id: `${usuarioId}-credential`,
        issuer: "local:credential",
        accountId: usuarioId,
        providerId: "credential",
        userId: usuarioId,
        password: senhaHash,
      });
  }
  return senha;
}

/**
 * "Tirar o acesso" (V3, item 5): o dono nao tem esse botao na tela (dúvida
 * 7 do BRIEF.md), conferido aqui tambem, nao só escondido na UI.
 */
export async function tirarAcesso(clienteId: number, usuarioId: string): Promise<void> {
  const [membro] = await db()
    .select({ papel: membrosMarca.papel })
    .from(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  if (!membro) return;
  if (membro.papel === "dono") {
    throw new ErroCliente(textosAdmin.acessos.erroDonoNaoPodeSerTirado);
  }
  await db()
    .delete(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
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
});

/**
 * /conta (etapa D, parte 2): nome e perfis, gravados numa unica UPDATE.
 * Diferente de salvarDadosFixos (/comecar), que exige cidade e persona: a
 * tela de conta nao mostra esses campos, entao usar salvarDadosFixos aqui
 * exigiria ler o cliente primeiro para preservar o resto (uma
 * leitura-depois-escrita sem necessidade, no mesmo tipo de corrida de dado
 * ja corrigido em src/servicos/briefing.ts). A hora do lembrete e da
 * pessoa, nao da marca (V3, item 4): `salvarHoraLembrete`, abaixo.
 */
export async function salvarPerfilConta(clienteId: number, dadosBrutos: unknown): Promise<Cliente> {
  const dados = perfilContaSchema.parse(dadosBrutos);

  const perfis: PerfisCliente = {
    instagram: dados.perfis.instagram?.trim() || null,
    tiktok: dados.perfis.tiktok?.trim() || null,
    youtube: dados.perfis.youtube?.trim() || null,
  };

  /**
   * O Instagram mudou (V8, item 1): o `meta_ig_id` que estava salvo era da
   * conta antiga, e `resolverMetaIgId` nunca resolve de novo sozinho
   * enquanto houver um id salvo. Zera junto com o perfil, na mesma
   * atualizacao, para a chamada logo abaixo resolver contra o handle novo.
   */
  const [antes] = await db().select({ perfis: clientes.perfis }).from(clientes).where(eq(clientes.id, clienteId));
  const instagramMudou = (antes?.perfis?.instagram ?? null) !== perfis.instagram;

  const [cliente] = await db()
    .update(clientes)
    .set(instagramMudou ? { nome: dados.nome, perfis, metaIgId: null } : { nome: dados.nome, perfis })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar a conta; cliente nao encontrado.");

  /**
   * Dispara a resolucao do id da Meta SEM ESPERAR (V8, item 1; achado da revisao: `aguardarJanela`,
   * `meta-api.ts`, pode demorar de verdade, quase uma hora, quando o orcamento de 200 chamadas por
   * hora esta esgotado, e salvar o perfil e uma acao interativa que nao pode ficar presa nisso). Um
   * cliente ja resolvido nem chama a rede. `resolverMetaIgId` pode relancar um erro de token ou de
   * limite (para o job da curva saber parar de tentar a Meta); aqui isso e so ignorado.
   */
  if (perfis.instagram) void resolverMetaIgId(clienteId).catch(() => undefined);

  return cliente;
}

export type PreferenciasUsuario = typeof preferenciasUsuario.$inferSelect;

export async function preferenciasDoUsuario(usuarioId: string): Promise<PreferenciasUsuario | null> {
  const [linha] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, usuarioId));
  return linha ?? null;
}

/** "HH:MM" (etapa 13, ajuste 4: o navegador nao obriga o `step` de hora cheia do campo). */
const horaMinutoSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "hora invalida");
/** O tema do dia nasce as 05:30; o lembrete nao faz sentido antes disso nem tarde da noite. */
const HORA_LEMBRETE_MINIMA = "06:00";
const HORA_LEMBRETE_MAXIMA = "22:00";

function arredondarParaHoraCheia(horaMinuto: string): string {
  const [hora] = horaMinuto.split(":");
  return `${hora}:00`;
}

/**
 * A hora do lembrete e da pessoa, nao da marca (V3, item 4: o Bruno pode
 * querer lembrete as 8h numa marca e as 20h noutra? Nao, o lembrete passa a
 * ser um so por pessoa, item 6). Cria a linha de preferencias na primeira
 * vez (quem existia antes da V3 ja tem uma, copiada pela migracao 0025).
 * Arredondada para a hora cheia anterior antes de gravar; a faixa permitida
 * (etapa 13, ajuste 3) e conferida depois do arredondamento.
 */
export async function salvarHoraLembrete(usuarioId: string, horaMinutoBruto: string): Promise<PreferenciasUsuario> {
  const horaMinuto = horaMinutoSchema.parse(horaMinutoBruto);
  const horaLembrete = arredondarParaHoraCheia(horaMinuto);
  if (horaLembrete < HORA_LEMBRETE_MINIMA || horaLembrete > HORA_LEMBRETE_MAXIMA) {
    throw new ErroCliente(
      `hora do lembrete fora da faixa permitida (${HORA_LEMBRETE_MINIMA} a ${HORA_LEMBRETE_MAXIMA}): ${horaLembrete}`,
    );
  }

  const [preferencias] = await db()
    .insert(preferenciasUsuario)
    .values({ usuarioId, horaLembrete })
    .onConflictDoUpdate({ target: preferenciasUsuario.usuarioId, set: { horaLembrete } })
    .returning();
  return preferencias;
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
 * O layout do painel chama isto no maximo uma vez por dia por marca (etapa
 * 12, decisao 5): confere com `acessouHoje` antes de chamar, para nao
 * gravar a cada navegacao. Grava nos dois niveis (V3, item 1):
 * `clientes.ultimoAcessoEm`, a marca inteira, e o `ultimoAcessoEm` desta
 * pessoa em `membrosMarca`, para o cartao "quem tem acesso" do admin.
 */
export async function registrarAcessoHoje(usuarioId: string, clienteId: number): Promise<void> {
  const agora = new Date();
  await Promise.all([
    db().update(clientes).set({ ultimoAcessoEm: agora }).where(eq(clientes.id, clienteId)),
    db()
      .update(membrosMarca)
      .set({ ultimoAcessoEm: agora })
      .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId))),
  ]);
}

/**
 * Aceite dos termos no primeiro acesso (etapa 12, decisao 7; V3, item 7: e
 * da pessoa, nao da marca): quem nao aceitou nao passa do layout
 * `(completo)`, em nenhuma marca. Cria a linha de preferencias na primeira
 * vez (mesmo caso de `salvarHoraLembrete`).
 */
export async function aceitarTermos(usuarioId: string): Promise<PreferenciasUsuario> {
  const agora = new Date();
  const [preferencias] = await db()
    .insert(preferenciasUsuario)
    .values({ usuarioId, aceitouTermosEm: agora })
    .onConflictDoUpdate({ target: preferenciasUsuario.usuarioId, set: { aceitouTermosEm: agora } })
    .returning();
  return preferencias;
}
