/**
 * O "ver como" (E46 PR 2): o que mora no banco. Entrar só vale para um admin, numa pessoa que é membro da conta e não é admin; cada entrada e saída fica em
 * `ver_como_entradas`. O cookie e a leitura do modo ficam em `lib/ver-como.ts`; aqui não há cookie nem Next.
 */
import { and, desc, eq, isNull, lte, ne, or } from "drizzle-orm";

import { db } from "@/db";
import { clientes, membrosMarca, user, verComoEntradas, type VerComoEntrada } from "@/db/schema";
import { DURACAO_VER_COMO_MS } from "@/lib/ver-como-cookie";

export class ErroVerComo extends Error {}

export type MotivoSaidaVerComo = NonNullable<VerComoEntrada["motivoSaida"]>;

/**
 * A pessoa como a conta a tem: membro de uma conta ativa e não administradora. `null` quando não é membro, a conta está desativada ou a pessoa é admin (o modo nunca mostra
 * outro admin, nem uma conta de que a pessoa não faz parte). É a mesma conferência na entrada e em toda leitura do modo.
 */
export async function pessoaDaConta(pessoaId: string, clienteId: number) {
  const [pessoa] = await db()
    .select({ usuario: user, papel: membrosMarca.papel })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .innerJoin(clientes, eq(clientes.id, membrosMarca.clienteId))
    .where(and(eq(membrosMarca.usuarioId, pessoaId), eq(membrosMarca.clienteId, clienteId), eq(clientes.ativo, true), or(isNull(user.role), ne(user.role, "admin"))));
  return pessoa ?? null;
}

/**
 * Registra a entrada. Confere de novo, no banco, que quem entra é admin e que a pessoa é membro da conta e não é admin (a Server Action já conferiu a sessão; esta é a segunda
 * camada, igual à `garantirSessaoAdmin`). Qualquer entrada anterior ainda aberta do mesmo admin fecha como `trocou`: um admin só vê uma conta por vez.
 */
export async function registrarEntradaVerComo(adminId: string, clienteId: number, pessoaId: string, agora: Date = new Date()): Promise<VerComoEntrada> {
  const [admin] = await db().select({ role: user.role }).from(user).where(eq(user.id, adminId));
  if (!admin || admin.role !== "admin") throw new ErroVerComo("Só um administrador pode ver como outra pessoa.");

  const pessoa = await pessoaDaConta(pessoaId, clienteId);
  if (!pessoa) throw new ErroVerComo("Esta pessoa não tem acesso a esta conta, ou é administradora.");

  // As anteriores ainda abertas fecham: as que já passaram da hora como `expirou` (o admin fechou a aba), as demais como `trocou`.
  const abertas = and(eq(verComoEntradas.adminId, adminId), isNull(verComoEntradas.saiuEm));
  await db().update(verComoEntradas).set({ saiuEm: agora, motivoSaida: "expirou" }).where(and(abertas, lte(verComoEntradas.expiraEm, agora)));
  await db().update(verComoEntradas).set({ saiuEm: agora, motivoSaida: "trocou" }).where(abertas);

  const [entrada] = await db()
    .insert(verComoEntradas)
    .values({ adminId, pessoaId, clienteId, entrouEm: agora, expiraEm: new Date(agora.getTime() + DURACAO_VER_COMO_MS) })
    .returning();
  return entrada;
}

/** Fecha a entrada (se ainda estiver aberta; fechar duas vezes não muda o primeiro motivo). */
export async function registrarSaidaVerComo(entradaId: number, motivo: MotivoSaidaVerComo, agora: Date = new Date()): Promise<void> {
  await db()
    .update(verComoEntradas)
    .set({ saiuEm: agora, motivoSaida: motivo })
    .where(and(eq(verComoEntradas.id, entradaId), isNull(verComoEntradas.saiuEm)));
}

/** A entrada continua aberta no banco (não saiu, não foi trocada)? O cookie sozinho não basta: uma entrada fechada derruba o modo mesmo com o cookie ainda de pé. */
export async function entradaAberta(entradaId: number): Promise<VerComoEntrada | null> {
  const [entrada] = await db()
    .select()
    .from(verComoEntradas)
    .where(and(eq(verComoEntradas.id, entradaId), isNull(verComoEntradas.saiuEm)));
  return entrada ?? null;
}

export type LinhaVerComo = {
  id: number;
  pessoaNome: string;
  pessoaEmail: string;
  entrouEm: Date;
  saiuEm: Date | null;
  expiraEm: Date;
  motivoSaida: MotivoSaidaVerComo | null;
};

/** As últimas entradas numa conta, para a página da conta no admin (o admin é sempre quem está olhando, então o nome dele não vai na linha). */
export async function ultimasEntradasVerComo(clienteId: number, limite = 10): Promise<LinhaVerComo[]> {
  return db()
    .select({
      id: verComoEntradas.id,
      pessoaNome: user.name,
      pessoaEmail: user.email,
      entrouEm: verComoEntradas.entrouEm,
      saiuEm: verComoEntradas.saiuEm,
      expiraEm: verComoEntradas.expiraEm,
      motivoSaida: verComoEntradas.motivoSaida,
    })
    .from(verComoEntradas)
    .innerJoin(user, eq(user.id, verComoEntradas.pessoaId))
    .where(eq(verComoEntradas.clienteId, clienteId))
    .orderBy(desc(verComoEntradas.entrouEm))
    .limit(limite);
}

/** As pessoas da conta que o admin pode ver (todas menos admins), para a folha de escolha. */
export async function pessoasVisiveis(clienteId: number): Promise<{ usuarioId: string; nome: string; email: string; papel: string }[]> {
  return db()
    .select({ usuarioId: user.id, nome: user.name, email: user.email, papel: membrosMarca.papel })
    .from(membrosMarca)
    .innerJoin(user, eq(user.id, membrosMarca.usuarioId))
    .where(and(eq(membrosMarca.clienteId, clienteId), or(isNull(user.role), ne(user.role, "admin"))));
}
