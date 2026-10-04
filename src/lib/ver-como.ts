/**
 * O "ver como" (E46 PR 2): como o painel lê o modo, e como as Server Actions o recusam. As sete regras de segurança da ordem moram aqui e no cookie (`ver-como-cookie.ts`):
 *
 * 1. Só admin entra (a Server Action de entrada passa por `garantirSessaoAdmin`; aqui o modo só vale se a SESSÃO REAL for de admin).
 * 2. A sessão do admin nunca vira a da pessoa: o cookie é próprio e assinado; `sessaoDoPainel` devolve uma visão em memória com a identidade da pessoa só para este pedido, sem tocar
 *    na sessão do better-auth nem em senha. Cookie sem sessão de admin, de outro admin, expirado, estragado ou de uma entrada já fechada é ignorado (e o layout manda apagar).
 * 3. Expira sozinho em 30 minutos (a hora vai no cookie assinado e na linha do banco).
 * 4. Toda entrada e saída fica em `ver_como_entradas` (`servicos/ver-como.ts`).
 * 5. Tudo que manda algo para fora, gasta ou ensina em nome da pessoa chama `exigirForaDoVerComo` (ou `recusaDoVerComo`) na primeira linha da Server Action: a lista é fechada no
 *    servidor, e o `checar-ver-como` reprova a Server Action do painel que não escolheu (chamar ou ficar na lista de leitura livre).
 * 6. `ultimo_acesso_em` e o aviso não contam a visita do admin: o layout não grava o acesso no modo.
 * 7. A conta do modo é a do cookie (`clienteAtivoDoUsuario` a devolve, conferida no banco), não a da sessão; a troca de marca fica recusada.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import type { user } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { type CarregaVerComo, lerCookieVerComo, NOME_COOKIE_VER_COMO } from "@/lib/ver-como-cookie";
import { entradaAberta, ErroVerComo, pessoaDaConta } from "@/servicos/ver-como";

export { ErroVerComo };

export const MENSAGEM_VER_COMO_DESLIGADO = "Desligado no modo ver como: isso muda ou manda algo em nome da pessoa, e só ela faz.";

export type ModoVerComo = {
  entradaId: number;
  adminId: string;
  adminNome: string;
  pessoa: typeof user.$inferSelect;
  clienteId: number;
  expiraEm: Date;
};

export type EstadoVerComo =
  | { estado: "inativo" }
  /** O cookie sobrou (estragado, expirado, sem a sessão do admin, de outro admin, de uma entrada fechada): ignorado, e o layout manda apagar. */
  | { estado: "limpar"; carga: CarregaVerComo | null }
  | { estado: "ativo"; modo: ModoVerComo };

/** A sessão real do pedido, lida uma vez só (a do admin, nunca a da pessoa). */
const sessaoRealDoPedido = cache(async () => sessaoAtual());

async function lerCookieBruto(): Promise<string | undefined> {
  try {
    return (await cookies()).get(NOME_COOKIE_VER_COMO)?.value;
  } catch {
    // Fora de uma requisição do Next.js (job, script, teste de integração): sem cookie, sem modo.
    return undefined;
  }
}

/** O estado do modo neste pedido. Só `ativo` quando tudo bate: assinatura, hora, sessão real de admin do mesmo id, entrada aberta no banco e pessoa ainda membro da conta. */
export const lerEstadoVerComo = cache(async (): Promise<EstadoVerComo> => {
  const leitura = lerCookieVerComo(await lerCookieBruto());
  if (leitura.estado === "ausente") return { estado: "inativo" };
  if (leitura.estado === "invalido") return { estado: "limpar", carga: null };
  if (leitura.estado === "expirado") return { estado: "limpar", carga: leitura.carga };

  const { carga } = leitura;
  const real = await sessaoRealDoPedido();
  if (!real || real.user.role !== "admin" || real.user.id !== carga.a) return { estado: "limpar", carga };

  const entrada = await entradaAberta(carga.r);
  if (!entrada || entrada.adminId !== carga.a || entrada.pessoaId !== carga.p || entrada.clienteId !== carga.c || entrada.expiraEm.getTime() <= Date.now()) {
    return { estado: "limpar", carga };
  }
  const pessoa = await pessoaDaConta(carga.p, carga.c);
  if (!pessoa) return { estado: "limpar", carga };

  return {
    estado: "ativo",
    modo: { entradaId: entrada.id, adminId: carga.a, adminNome: real.user.name, pessoa: pessoa.usuario, clienteId: carga.c, expiraEm: new Date(carga.e) },
  };
});

/**
 * A sessão para o painel do cliente. Fora do modo, a sessão real. No modo, a mesma sessão do admin com a IDENTIDADE da pessoa no lugar do `user` (em memória, só neste pedido):
 * tudo o que o painel lê "da sessão" (a conta ativa, as preferências, o nome) passa a ser o da pessoa, e nada disso vira cookie nem sessão do better-auth. `verComo` vem junto
 * (`null` fora do modo) para a faixa e para as telas que explicam o que está desligado.
 */
export async function sessaoDoPainel() {
  const real = await sessaoRealDoPedido();
  if (!real) return null;
  const estado = await lerEstadoVerComo();
  if (estado.estado !== "ativo") return { ...real, verComo: null as ModoVerComo | null };
  const { pessoa } = estado.modo;
  // `session` também troca o dono (só em memória): quem ler `sessao.session.userId` dentro do painel vê a pessoa, nunca o admin por engano.
  return {
    ...real,
    session: { ...real.session, userId: pessoa.id },
    user: { ...real.user, id: pessoa.id, name: pessoa.name, email: pessoa.email, image: pessoa.image, role: pessoa.role ?? "cliente" },
    verComo: estado.modo as ModoVerComo | null,
  };
}

/** O modo está ligado neste pedido? */
export async function modoVerComoLigado(): Promise<boolean> {
  return (await lerEstadoVerComo()).estado === "ativo";
}

/** A frase de recusa quando o modo está ligado, ou `null`. Para as Server Actions que devolvem `ResultadoAcao` (o erro vai para a tela como as outras recusas). */
export async function recusaDoVerComo(): Promise<string | null> {
  return (await modoVerComoLigado()) ? MENSAGEM_VER_COMO_DESLIGADO : null;
}

/** Para as Server Actions que não devolvem resultado: lança, e nada acontece. Primeira linha da ação, antes de ler ou gravar qualquer coisa. */
export async function exigirForaDoVerComo(): Promise<void> {
  if (await modoVerComoLigado()) throw new ErroVerComo(MENSAGEM_VER_COMO_DESLIGADO);
}
