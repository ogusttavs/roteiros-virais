import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { db } from "@/db";
import { briefings, clientes, nichos, user, type Cliente } from "@/db/schema";
import { auth } from "@/lib/auth";

/** Nome com mensagem para o cliente (plataforma/CLAUDE.md, convencao de erros). */
export class ErroAcessoNegado extends Error {}

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
