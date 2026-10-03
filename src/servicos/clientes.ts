import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";
import { and, eq, inArray } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";

import { db } from "@/db";
import {
  account,
  briefings,
  clientes,
  contextoMarca,
  contextoMarcaItens,
  membrosMarca,
  nichos,
  preferenciasUsuario,
  user,
  type Alcance,
  type Cliente,
  type PapelMarca,
  type PerfisCliente,
  type Plataforma,
  type PlanoMarca,
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
import { semBarrasNoFim, TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL } from "@/lib/perfil-redes";
import { gerarSenhaLegivel } from "@/lib/senha-legivel";
import { sessaoAtual } from "@/lib/sessao";
import { normalizarSite, siteValido, TAMANHO_MAXIMO_DO_SITE } from "@/lib/site-valido";
import { enfileirarEntenderMarca } from "@/servicos/contexto-marca";
import { resolverMetaIgId } from "@/servicos/meta-ig-cliente";
import { cancelarPedidoAberto, registrarPedidoDeRamo } from "@/servicos/pedidos-de-ramo";
import { enfileirarAnaliseDaPropriaMarca } from "@/servicos/perfis-analisados";
import { desligarSetorSeSemMarca, setorParaAMarca } from "@/servicos/ramos";
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
 * Todas as marcas ativas de que o usuario e membro (V3, item 1, escopo
 * 4.13), ordenadas por nome: a lista "Suas marcas" da casca, a folha de
 * troca, o seletor e os chips "Falar de".
 *
 * P1, item 7 (achado do Fable desativando Velura e Hiduck em producao):
 * uma marca desativada nunca aparece aqui, so no admin (que tem a propria
 * consulta, sem este filtro, para reativar). `resolverMarcaAtiva` nunca ve
 * uma marca desativada nesta lista, entao um cookie apontando para uma
 * cai sozinho na marca padrao, sem tratamento especial.
 */
export async function marcasDoUsuario(usuarioId: string): Promise<Cliente[]> {
  const linhas = await db()
    .select({ cliente: clientes })
    .from(membrosMarca)
    .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(clientes.ativo, true)))
    .orderBy(clientes.nome);
  return linhas.map((l) => l.cliente);
}

/** Como `briefingCompleto`, para varias marcas de uma vez (`marcaPadrao`, uma consulta so em vez de N). */
async function briefingsCompletos(clienteIds: number[]): Promise<Set<number>> {
  if (clienteIds.length === 0) return new Set();
  const linhas = await db()
    .select({ clienteId: briefings.clienteId })
    .from(briefings)
    .where(and(inArray(briefings.clienteId, clienteIds), eq(briefings.completo, true)));
  return new Set(linhas.map((l) => l.clienteId));
}

/**
 * A marca padrao entre as que o usuario pertence, para quando o cookie nao
 * serve. Prefere uma marca com briefing completo antes de qualquer outra
 * (V12b, item 0: quem tem varias marcas e entra pela primeira vez no
 * aparelho, sem cookie ainda, cai numa marca que ja funciona, nao presa no
 * briefing incompleto de outra); entre as empatadas nisso, a de acesso mais
 * recente, depois a mais nova.
 */
async function marcaPadrao(marcas: Cliente[]): Promise<Cliente> {
  const completos = await briefingsCompletos(marcas.map((m) => m.id));
  return [...marcas].sort((a, b) => {
    const completoA = completos.has(a.id);
    const completoB = completos.has(b.id);
    if (completoA !== completoB) return completoA ? -1 : 1;
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
 * consulta acima ja provou que sao do usuario. Uma marca desativada (P1,
 * item 7) cai na mesma regra: `marcasDoUsuario` ja a tira da lista, entao um
 * cookie apontando para ela nunca acha `marcaDoCookie` e a marca padrao
 * decide, sem tratamento especial aqui.
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

  const padrao = await marcaPadrao(marcas);
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
  /** O e-mail do dono (`membrosMarca`, papel "dono"), nulo quando a marca ainda nao tem ninguem (V12b, item 2). */
  email: string | null;
  nichoNome: string | null;
  ativo: boolean;
};

/**
 * Lista para /admin/clientes (brief-frontend.md, 6.10). O e-mail vem do dono
 * em `membrosMarca`, nao de `clientes.usuarioId` (V12b, item 2: uma marca
 * criada pelo admin sem ninguem ainda nunca escreve esse campo legado); os
 * dois `leftJoin` deixam a marca aparecer mesmo sem dono nenhum.
 */
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
    .leftJoin(membrosMarca, and(eq(membrosMarca.clienteId, clientes.id), eq(membrosMarca.papel, "dono")))
    .leftJoin(user, eq(user.id, membrosMarca.usuarioId))
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
 * sozinha, então uma falha aqui não derruba a ação inteira. `headers()` só
 * funciona dentro de uma requisição de verdade (mesmo motivo documentado em
 * `resolverMarcaAtiva`, acima); o try/catch cobre a função inteira, não só a
 * chamada à API, para um teste de integração que chama `darAcesso` direto
 * (fora de uma Server Action) também cair no "bônus", não travar a ação.
 */
async function mandarConviteMagico(email: string): Promise<void> {
  try {
    const cabecalhos = await headers();
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/comecar" }, headers: cabecalhos });
  } catch {
    // Best-effort; ver comentario acima.
  }
}

/**
 * "Nova marca" (V12b, item 2): so a marca, sem ninguem ainda. A pessoa entra
 * depois, dentro da marca, por `darAcesso` (que decide quem vira dono). Nome
 * e nicho continuam obrigatorios; tipo e plano tem o mesmo padrao de antes.
 */
export async function criarMarca(dados: {
  nome: string;
  nichoId: number;
  /** V9a, item 4: o admin escolhe ao criar a marca; "negocio" é o padrão, sem tela nova. */
  tipo?: TipoMarca;
  /** V9b-0, item 1: o admin escolhe ao criar a marca; "padrao" é o padrão, sem tela nova. */
  plano?: PlanoMarca;
}): Promise<Cliente> {
  const tipo = dados.tipo ?? "negocio";
  const plano = dados.plano ?? "padrao";
  const [cliente] = await db().insert(clientes).values({ nome: dados.nome, nichoId: dados.nichoId, tipo, plano }).returning();
  return cliente;
}

/**
 * Nome da marca, editavel no admin (V12b, item 3): sem vazio, ate 80
 * caracteres, espacos aparados, mesmo padrao de `atualizarNicho`.
 */
export async function renomearCliente(clienteId: number, nome: string): Promise<Cliente> {
  const nomeAparado = nome.trim();
  if (!nomeAparado) throw new ErroCliente("o nome da marca nao pode ficar vazio.");
  if (nomeAparado.length > 80) throw new ErroCliente("o nome da marca pode ter ate 80 caracteres.");

  const [cliente] = await db().update(clientes).set({ nome: nomeAparado }).where(eq(clientes.id, clienteId)).returning();
  if (!cliente) throw new ErroCliente("nao foi possivel renomear a marca; marca nao encontrada.");
  return cliente;
}

/**
 * Nome de uma pessoa, editavel no admin em "Quem tem acesso" (V12b, item 4):
 * confere que ela e membro desta marca antes de gravar (nunca por
 * `usuarioId` solto, mesmo isolamento de `tirarAcesso`), e grava em
 * `user.name` (a mesma coluna que a propria pessoa edita em Conta).
 */
export async function renomearPessoa(clienteId: number, usuarioId: string, nome: string): Promise<void> {
  const nomeAparado = nome.trim();
  if (!nomeAparado) throw new ErroCliente("o nome nao pode ficar vazio.");
  if (nomeAparado.length > 80) throw new ErroCliente("o nome pode ter ate 80 caracteres.");

  const [membro] = await db()
    .select({ id: membrosMarca.id })
    .from(membrosMarca)
    .where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)));
  if (!membro) throw new ErroCliente("esta pessoa nao tem acesso a esta marca.");

  await db().update(user).set({ name: nomeAparado }).where(eq(user.id, usuarioId));
}

/** V9b-0, item 1: o admin liga ou desliga o limite diário de roteiros de uma marca em `/admin/clientes/[id]`. */
export async function definirPlano(clienteId: number, plano: PlanoMarca): Promise<void> {
  await db().update(clientes).set({ plano }).where(eq(clientes.id, clienteId));
}

/**
 * Trocar o tipo de conteúdo de uma marca (P1, item 1): as doze perguntas do
 * negócio e as da pessoa têm o mesmo id, mas enunciados diferentes, então
 * uma resposta de um tipo nunca pode ficar pareada com a avaliação do
 * outro. O admin já avisa antes de chamar isto; aqui a troca sempre apaga o
 * briefing, sem checar se havia resposta de verdade.
 *
 * F1, item 5 (resto da revisão do PR #70): pedir o tipo que a marca já tem
 * não apaga o briefing à toa (salvar duas vezes seguidas no admin sem trocar
 * nada não pode custar o briefing da pessoa); e as duas escritas, marca e
 * briefing, andam juntas numa transação, para nunca sobrar uma marca com o
 * tipo novo e o briefing do tipo antigo se a segunda escrita falhar.
 */
export async function mudarTipoMarca(clienteId: number, tipo: TipoMarca): Promise<Cliente> {
  return db().transaction(async (tx) => {
    // "no key update", não "update": o trabalho de leitura da marca precisa de "key share" nesta linha ao inserir itens, e um "update"
    // aqui, somado à espera pela linha de estado (abaixo), travaria um no outro. O tipo não é coluna de chave.
    const [clienteAtual] = await tx.select().from(clientes).where(eq(clientes.id, clienteId)).for("no key update");
    if (!clienteAtual) throw new ErroCliente("nao foi possivel trocar o tipo; marca nao encontrada.");
    if (clienteAtual.tipo === tipo) return clienteAtual;

    const [cliente] = await tx.update(clientes).set({ tipo }).where(eq(clientes.id, clienteId)).returning();
    if (!cliente) throw new ErroCliente("nao foi possivel trocar o tipo; marca nao encontrada.");

    await tx
      .update(briefings)
      .set({ respostas: {}, avaliacoes: {}, notaGeral: null, completo: false, perfil: null })
      .where(eq(briefings.clienteId, clienteId));

    // E38 PR 2: o que a pessoa confirmou sobre a marca foi escrito sob o tipo antigo ("vende", "fala" de um
    // negócio não descrevem uma pessoa) e voltaria ao perfil de todo roteiro assim que o briefing novo fosse
    // compilado, sem ela confirmar de novo. Zera junto com o briefing: a leitura recomeça quando o briefing
    // novo ficar completo (o resumo dele entra no hash, então a IA roda de novo).
    // Primeiro a linha de estado, que é a trava da leitura (`entender-marca` a trava dentro da transação em que grava os itens):
    // espera uma leitura em andamento terminar, enxerga os itens que ela inseriu e os apaga junto; e uma leitura que vier depois
    // não acha a linha e não grava nada.
    await tx.delete(contextoMarca).where(eq(contextoMarca.clienteId, clienteId));
    await tx.delete(contextoMarcaItens).where(eq(contextoMarcaItens.clienteId, clienteId));

    return cliente;
  });
}

export type ResultadoDarAcesso = { tipo: "jaTinhaLogin"; nome: string } | { tipo: "convite"; senha: string };

/**
 * "Dar acesso" a uma marca (V3, item 5, AdminCliente.dc.html; V12b, item 2:
 * agora tambem o jeito de a primeira pessoa entrar numa marca criada sem
 * ninguem). Quem ja entra no painel ganha a marca na hora, sem senha nova,
 * com o nome que ja tinha (o `nome` daqui nao sobrescreve); quem nao tem
 * login recebe usuario com senha gerada e o nome que a folha "Dar acesso"
 * pediu (V12b, item 4: antes era sempre "Sem nome ainda", a folha nao
 * perguntava). Dono e quem chega primeiro (marca sem nenhum membro ainda),
 * os seguintes entram como membro.
 */
export async function darAcesso(clienteId: number, nome: string, email: string): Promise<ResultadoDarAcesso> {
  const membrosAtuais = await membrosDaMarca(clienteId);
  const papel: PapelMarca = membrosAtuais.length === 0 ? "dono" : "membro";
  const [usuarioExistente] = await db().select().from(user).where(eq(user.email, email));

  if (usuarioExistente) {
    const [jaMembro] = await db()
      .select({ id: membrosMarca.id })
      .from(membrosMarca)
      .where(and(eq(membrosMarca.usuarioId, usuarioExistente.id), eq(membrosMarca.clienteId, clienteId)));
    if (jaMembro) {
      throw new ErroCliente(textosAdmin.acessos.erroJaTemAcesso);
    }
    await db().insert(membrosMarca).values({ usuarioId: usuarioExistente.id, clienteId, papel });
    return { tipo: "jaTinhaLogin", nome: usuarioExistente.name };
  }

  const { usuarioId, senha } = await criarUsuarioComSenhaGerada(email, nome.trim() || NOME_SEM_NOME_AINDA);
  await db().insert(membrosMarca).values({ usuarioId, clienteId, papel });
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

/** O nome da marca vai na entrada de prompts de IA e em telas; sem teto, um nome de um milhão de caracteres seria cobrado em toda chamada. */
const NOME_MAXIMO = 120;

/** O campo de um perfil nas redes: um endereço inteiro cabe, um texto enorme (ação que a tela não mandou) não. */
function campoDePerfil() {
  return z.string().trim().max(TAMANHO_MAXIMO_DO_CAMPO_DE_PERFIL).optional();
}

/**
 * O site da marca (E38 PR 2) como o servidor o aceita: aparado, com o tamanho limitado (o que passa disto
 * nem é examinado), o endereço sem esquema virando https (a pessoa digita "minhaloja.com.br"), e só um
 * endereço público de verdade. `undefined` continua `undefined` (quem não manda o campo não apaga o site).
 */
function campoSite() {
  return z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DO_SITE, { message: "esse endereço não parece um site válido" })
    .optional()
    .transform((valor) => (valor === undefined ? undefined : normalizarSite(valor)))
    .refine((valor) => !valor || siteValido(valor), { message: "esse endereço não parece um site válido" });
}

/**
 * Dados fixos do briefing (briefing-e-rubricas.md, secao 1; brief-frontend.md,
 * 6.2): sem nota, so validacao. "Ramo" e um nicho da lista (nichoId) ou, se o
 * cliente escolher "outro", um texto livre em ramoOutro; os dois nunca
 * coexistem. Perfis, site e quem grava sao opcionais aqui.
 *
 * V12c, item 1 (a E37b): cidade e bairro saem da validacao, `alcance` entra
 * no lugar ("brasil" ou "local"); com "local", `regiao` passa a ser
 * obrigatoria. E42a, item 1 (achado do Gustavo em 02/10): mais dois valores,
 * "outro_pais" (exige `pais`) e "mais_de_um_pais" (exige `paises`).
 */
export const dadosFixosSchema = z
  .object({
    nome: z.string().trim().min(1).max(NOME_MAXIMO),
    alcance: z.enum(["brasil", "local", "outro_pais", "mais_de_um_pais"]),
    regiao: z.string().trim().optional(),
    pais: z.string().trim().optional(),
    paises: z.string().trim().optional(),
    site: campoSite(),
    nichoId: z.number().int().positive().optional(),
    /** E45, PR 1: o ramo escolhido no catálogo (o `slug` de `src/config/ramos.ts`); o servidor acha ou cria o setor dele. */
    ramo: z.string().trim().min(1).max(100).optional(),
    ramoOutro: z.string().trim().optional(),
    /** P1, item 2: "conhecido" e "negocios" sao valores da persona da marca pessoa (briefing-e-rubricas.md, secao 1b). */
    persona: z.enum(["negocio", "criador", "conhecido", "negocios"]),
    perfis: z
      .object({
        instagram: campoDePerfil(),
        tiktok: campoDePerfil(),
        youtube: campoDePerfil(),
      })
      .optional(),
    quemGrava: z.enum(["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"]).optional(),
  })
  .refine((dados) => Boolean(dados.ramo) || Boolean(dados.nichoId) || Boolean(dados.ramoOutro?.trim()), {
    message: "escolha um ramo da lista ou descreva o seu",
    path: ["ramo"],
  })
  .refine((dados) => dados.alcance !== "local" || Boolean(dados.regiao?.trim()), {
    message: "escreva a cidade ou região",
    path: ["regiao"],
  })
  .refine((dados) => dados.alcance !== "outro_pais" || Boolean(dados.pais?.trim()), {
    message: "escreva o país",
    path: ["pais"],
  })
  .refine((dados) => dados.alcance !== "mais_de_um_pais" || Boolean(dados.paises?.trim()), {
    message: "escreva quais países",
    path: ["paises"],
  });

export type DadosFixos = z.infer<typeof dadosFixosSchema>;

/**
 * Pontes entre a coluna `clientes.alcance` e as telas: a palavra "alcance"
 * está na lista de jargão do cliente (`regras-de-texto.ts`) e o
 * `checar-texto` reprova qualquer `.tsx` que a escreva, mesmo como nome de
 * campo; a tela chama o mesmo dado de "onde" (`config/briefing.ts`,
 * `DadosFixosConfig.onde`). Mesma ideia de `montarInstrucaoJargao`
 * (`avaliarResposta.ts`): a palavra fica só nos arquivos que o checar-texto
 * não varre.
 */
export function dadosOndeIniciais(
  cliente: Pick<Cliente, "alcance" | "regiao" | "pais" | "paises">,
): { onde: Alcance | null; regiao: string | null; pais: string | null; paises: string | null } {
  return { onde: cliente.alcance, regiao: cliente.regiao, pais: cliente.pais, paises: cliente.paises };
}

export function clienteTemOndeEscolhido(cliente: Pick<Cliente, "alcance">): boolean {
  return Boolean(cliente.alcance);
}

export async function salvarDadosFixos(clienteId: number, dadosBrutos: unknown): Promise<Cliente> {
  return (await salvarDadosFixosComPedido(clienteId, dadosBrutos)).cliente;
}

/**
 * `salvarDadosFixos` com o que o pedido de ramo decidiu: `limiteDeRamosNovos` é verdadeiro quando o teto de setores novos do dia segurou o
 * palpite (o pedido vai aberto, e a marca fica onde estava: sem setor, se não tinha). A tela diz isso em vez de prometer o ramo provisório.
 */
export async function salvarDadosFixosComPedido(clienteId: number, dadosBrutos: unknown): Promise<{ cliente: Cliente; limiteDeRamosNovos: boolean }> {
  const dados = dadosFixosSchema.parse(dadosBrutos);

  const perfis: PerfisCliente = {
    instagram: dados.perfis?.instagram?.trim() || null,
    tiktok: dados.perfis?.tiktok?.trim() || null,
    youtube: dados.perfis?.youtube?.trim() || null,
  };

  const [antes] = await db()
    .select({ site: clientes.site, perfis: clientes.perfis, nichoId: clientes.nichoId })
    .from(clientes)
    .where(eq(clientes.id, clienteId));

  // E45, PR 1: o ramo do catálogo vira o setor dele (que nasce, se for o primeiro a escolher; e se a marca já está nele, nada muda); o
  // `nichoId` de antes (um setor que o admin criou à mão, e que a tela mostra como o ramo atual) continua valendo quando a pessoa não
  // escolheu outro. E45, PR 2: no "Não achei o meu" (só o texto livre) a marca fica onde está por ora, e o pedido de ramo, registrado depois
  // da gravação, a põe provisoriamente no ramo mais próximo do que ela escreveu.
  const escolheuDaLista = Boolean(dados.ramo) || Boolean(dados.nichoId);
  const nichoId = dados.ramo
    ? (await setorParaAMarca(antes?.nichoId ?? null, dados.ramo)).nichoId
    : dados.nichoId
      ? dados.nichoId
      : (antes?.nichoId ?? null);

  const [cliente] = await db()
    .update(clientes)
    .set({
      nome: dados.nome,
      alcance: dados.alcance,
      regiao: dados.alcance === "local" ? (dados.regiao?.trim() ?? null) : null,
      pais: dados.alcance === "outro_pais" ? (dados.pais?.trim() ?? null) : null,
      paises: dados.alcance === "mais_de_um_pais" ? (dados.paises?.trim() ?? null) : null,
      site: dados.site?.trim() || null,
      nichoId,
      ramoOutro: escolheuDaLista ? null : (dados.ramoOutro?.trim() ?? null),
      persona: dados.persona,
      perfis,
      quemGrava: dados.quemGrava ?? null,
    })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar os dados; cliente nao encontrado.");

  // O setor de onde a marca saiu, se nasceu de um ramo do catálogo e ficou sem marca, para de ser pesquisado. A troca já foi gravada: isto
  // nunca a derruba.
  if (antes?.nichoId && antes.nichoId !== cliente.nichoId) await desligarSetorSeSemMarca(antes.nichoId).catch(() => undefined);

  // E45, PR 2: escolheu da lista, o pedido de ramo que estivesse aberto deixa de valer; escreveu com as palavras dela, o pedido abre (ou se
  // atualiza) e a marca entra no ramo provisório. O teto de setores novos do dia nunca derruba esta gravação: o pedido vai aberto do mesmo jeito.
  let clienteFinal = cliente;
  let limiteDeRamosNovos = false;
  if (escolheuDaLista) {
    await cancelarPedidoAberto(clienteId);
  } else {
    limiteDeRamosNovos = (await registrarPedidoDeRamo(clienteId, dados.ramoOutro ?? "")).limite;
    const [fresco] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    clienteFinal = fresco ?? cliente;
  }

  /**
   * E38 PR 2 (gatilho que o PR 1 deixou sem): o Começar é onde o site e os perfis são informados pela
   * primeira vez, e nada lia nenhum deles até a pessoa abrir a Conta ou o mês virar. Só quando o site ou
   * um perfil lido (Instagram, YouTube) mudou: salvar de novo sem mexer não bate no site dela. Sem
   * esperar, como `salvarPerfilConta` (ler o site e as redes pode demorar e não prende a ação).
   */
  if (fontesDeLeituraMudaram(antes, { site: cliente.site, perfis })) {
    void enfileirarEntenderMarca(clienteId, "evento").catch(() => undefined);
  }
  // A análise do perfil da própria marca (PR 1) só quando o Instagram ou o YouTube mudou, como em `salvarPerfilConta`: mexer só
  // no site não gasta uma chamada à Meta (que divide o orçamento por hora com a coleta) nem uma de IA por rede.
  if (perfisMudaram(antes?.perfis ?? null, perfis)) {
    void enfileirarAnaliseDaPropriaMarca(clienteId, perfis).catch(() => undefined);
  }
  return { cliente: clienteFinal, limiteDeRamosNovos };
}

/** O Instagram ou o YouTube mudou (são os dois que se analisam; o TikTok não). Comparação sem "@" e sem diferença de maiúscula. */
function perfisMudaram(antes: PerfisCliente | null, depois: PerfisCliente): boolean {
  const forma = (texto: string | null | undefined): string => (texto ?? "").trim().replace(/^@+/, "").toLowerCase();
  return forma(antes?.instagram) !== forma(depois.instagram) || forma(antes?.youtube) !== forma(depois.youtube);
}

/**
 * O site, o Instagram ou o YouTube mudaram e a marca ficou com algo para ler. O TikTok não conta:
 * não é lido (Apify suspenso). Comparação por texto aparado; a leitura normaliza o handle por conta própria.
 */
export function fontesDeLeituraMudaram(
  antes: { site: string | null; perfis: PerfisCliente | null } | undefined,
  depois: { site: string | null; perfis: PerfisCliente | null },
): boolean {
  const valor = (texto: string | null | undefined): string => (texto ?? "").trim();
  // O perfil se compara sem "@" e sem maiúscula ("@Loja" e "loja" são o mesmo perfil); o site, sem a barra do fim.
  const perfil = (texto: string | null | undefined): string => valor(texto).replace(/^@+/, "").toLowerCase();
  const endereco = (texto: string | null | undefined): string => semBarrasNoFim(valor(texto));
  const mudou =
    endereco(antes?.site) !== endereco(depois.site) ||
    perfil(antes?.perfis?.instagram) !== perfil(depois.perfis?.instagram) ||
    perfil(antes?.perfis?.youtube) !== perfil(depois.perfis?.youtube);
  const temAlgoParaLer = Boolean(valor(depois.site) || valor(depois.perfis?.instagram) || valor(depois.perfis?.youtube));
  return mudou && temAlgoParaLer;
}

const perfilContaSchema = z.object({
  nome: z.string().trim().min(1).max(NOME_MAXIMO),
  perfis: z.object({
    instagram: campoDePerfil(),
    tiktok: campoDePerfil(),
    youtube: campoDePerfil(),
  }),
  /**
   * E38 PR 2: o site da marca, editável na Conta (o desenho do Opus o põe depois do YouTube, no mesmo
   * lugar dos perfis). `undefined` não mexe no que está gravado (quem não manda o campo, como os
   * testes antigos, nunca apaga o site); vazio apaga.
   */
  site: campoSite(),
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
  const [antes] = await db().select({ perfis: clientes.perfis, site: clientes.site }).from(clientes).where(eq(clientes.id, clienteId));
  const instagramMudou = (antes?.perfis?.instagram ?? null) !== perfis.instagram;

  const [cliente] = await db()
    .update(clientes)
    .set({
      nome: dados.nome,
      perfis,
      ...(instagramMudou ? { metaIgId: null } : {}),
      ...(dados.site !== undefined ? { site: dados.site || null } : {}),
    })
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

  // E38, partes 2 e 3: o perfil da própria marca também entra na camada exclusiva; mesmo "sem
  // esperar" de cima, por rede preenchida (YouTube e Instagram; TikTok fica de fora por enquanto). Só
  // quando um perfil mudou: cada "Salvar" sem mexer em perfil gastaria uma chamada à Meta (que divide o
  // orçamento por hora com a coleta) e uma chamada de IA por rede, sem nada novo para ler.
  if (perfisMudaram(antes?.perfis ?? null, perfis)) {
    void enfileirarAnaliseDaPropriaMarca(clienteId, perfis).catch(() => undefined);
  }

  // E38 PR 2: o site ou um perfil lido mudou; sem mudança, não bate no site da pessoa de novo.
  if (fontesDeLeituraMudaram(antes, { site: cliente.site, perfis })) {
    void enfileirarEntenderMarca(clienteId, "evento").catch(() => undefined);
  }

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
 * "Onde está o seu público?" editável pela Conta (E42a, item 1, achado do Gustavo em 02/10, no
 * Começar pelo celular: "tá muito limitado ao Brasil"). Mesma validação de `dadosFixosSchema` para
 * esta fatia, mas sem ramo nem persona: a Conta não mostra esses campos, mesma razão de
 * `salvarPerfilConta` acima (ler o cliente primeiro para preservar o resto seria uma
 * leitura-depois-escrita sem necessidade).
 */
const ondeContaSchema = z
  .object({
    alcance: z.enum(["brasil", "local", "outro_pais", "mais_de_um_pais"]),
    regiao: z.string().trim().optional(),
    pais: z.string().trim().optional(),
    paises: z.string().trim().optional(),
  })
  .refine((dados) => dados.alcance !== "local" || Boolean(dados.regiao?.trim()), {
    message: "escreva a cidade ou região",
    path: ["regiao"],
  })
  .refine((dados) => dados.alcance !== "outro_pais" || Boolean(dados.pais?.trim()), {
    message: "escreva o país",
    path: ["pais"],
  })
  .refine((dados) => dados.alcance !== "mais_de_um_pais" || Boolean(dados.paises?.trim()), {
    message: "escreva quais países",
    path: ["paises"],
  });

export async function salvarOndeConta(clienteId: number, dadosBrutos: unknown): Promise<Cliente> {
  const dados = ondeContaSchema.parse(dadosBrutos);

  const [cliente] = await db()
    .update(clientes)
    .set({
      alcance: dados.alcance,
      regiao: dados.alcance === "local" ? (dados.regiao?.trim() ?? null) : null,
      pais: dados.alcance === "outro_pais" ? (dados.pais?.trim() ?? null) : null,
      paises: dados.alcance === "mais_de_um_pais" ? (dados.paises?.trim() ?? null) : null,
    })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar onde esta o publico; cliente nao encontrado.");
  return cliente;
}

/**
 * E45, PR 1: trocar o ramo pela Conta (antes só o Começar tinha o campo, e depois do briefing completo a pessoa ficava sem tela para
 * mudá-lo). Só o ramo: briefing, roteiros e temas já escritos continuam; a base de vídeos e os temas passam a ser os do ramo novo a
 * partir da próxima madrugada. O setor do ramo nasce, se for o primeiro a escolhê-lo (`garantirNichoDoRamo`). Fatia própria, como
 * `salvarOndeConta`: não exige persona, onde nem nome, que o Começar pede.
 */
export async function salvarRamoConta(clienteId: number, ramoSlug: string): Promise<{ cliente: Cliente; mudou: boolean }> {
  const [antes] = await db().select({ nichoId: clientes.nichoId }).from(clientes).where(eq(clientes.id, clienteId));
  if (!antes) throw new ErroCliente("nao foi possivel trocar o ramo; cliente nao encontrado.");

  const { nichoId } = await setorParaAMarca(antes.nichoId, ramoSlug);
  const [cliente] = await db().update(clientes).set({ nichoId, ramoOutro: null }).where(eq(clientes.id, clienteId)).returning();
  if (!cliente) throw new ErroCliente("nao foi possivel trocar o ramo; cliente nao encontrado.");
  // Escolheu da lista: o pedido de ramo aberto (o "Não achei o meu" de antes) deixa de valer.
  await cancelarPedidoAberto(clienteId);
  // O setor de onde a marca saiu, se nasceu de um ramo do catálogo e ficou sem marca, para de ser pesquisado (nunca derruba a troca).
  if (antes.nichoId && antes.nichoId !== nichoId) await desligarSetorSeSemMarca(antes.nichoId).catch(() => undefined);
  return { cliente, mudou: antes.nichoId !== nichoId };
}

const REDES_VALIDAS: Plataforma[] = ["instagram", "tiktok", "youtube"];

/**
 * A rede principal da marca (V12, item 3a): perguntada uma vez na porta
 * Reels ("Onde você posta mais?"), trocável pelo chip a qualquer hora.
 */
export async function salvarRedePrincipal(clienteId: number, rede: string): Promise<Cliente> {
  if (!REDES_VALIDAS.includes(rede as Plataforma)) {
    throw new ErroCliente(`rede invalida: ${rede}`);
  }

  const [cliente] = await db()
    .update(clientes)
    .set({ redePrincipal: rede as Plataforma })
    .where(eq(clientes.id, clienteId))
    .returning();

  if (!cliente) throw new ErroCliente("nao foi possivel salvar a rede principal; cliente nao encontrado.");
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
