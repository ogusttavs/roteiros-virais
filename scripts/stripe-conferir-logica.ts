/**
 * M2 (revisão de 23/11/2026): a conferência de uma marca com o Stripe, sem rede e sem banco próprios (recebe a porta e as linhas do banco), para provar com mentira em `stripe-conferir.test.ts`.
 * O ponto de entrada de linha de comando é `stripe-conferir.ts`. Só o webhook escrevia a assinatura; se um aviso se perdesse depois dos 3 dias que o Stripe reenvia, o banco ficava errado
 * até alguém acertar à mão. Aqui se lê o que o Stripe tem e se mostra a diferença; com `corrigir`, o banco é acertado pelo Stripe passando a assinatura pelo MESMO tratamento do aviso
 * (`lerEvento` e `tratarEventoDoStripe`), então a regra de escrita é uma só.
 */
import type { Assinatura } from "../src/db/schema";
import type { EventoDoStripe, PortaStripe } from "../src/lib/stripe";
import { lerEvento } from "../src/servicos/assinatura";

export type AssinaturaDoBanco = Pick<Assinatura, "stripeAssinaturaId" | "status" | "periodoFim" | "cancelaNoFimDoPeriodo" | "temFormaDePagamento" | "stripePrecoId">;

export type Diferenca = { campo: string; banco: string; stripe: string };

export type LinhaDaConferencia = {
  stripeAssinaturaId: string;
  situacao: "igual" | "diferente" | "so-no-stripe" | "so-no-banco";
  diferencas: Diferenca[];
  /** Só com `corrigir`: o banco foi acertado por esta linha. */
  corrigida: boolean;
};

const texto = (v: unknown): string => (v === null || v === undefined ? "(vazio)" : v instanceof Date ? v.toISOString() : String(v));

/** O que o Stripe diz que o banco devia ter, pelo mesmo caminho que um aviso `customer.subscription.updated` faria. */
function deveriaSer(sub: Record<string, unknown>) {
  const evento: EventoDoStripe = { id: "conferir", type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), data: { object: sub } };
  const leitura = lerEvento(evento);
  return leitura.tipo === "tratar" ? leitura.mudanca : null;
}

export function compararComOBanco(banco: AssinaturaDoBanco, sub: Record<string, unknown>): Diferenca[] {
  const m = deveriaSer(sub);
  if (!m) return [{ campo: "assinatura", banco: "existe", stripe: "nao e deste produto" }];
  const dif: Diferenca[] = [];
  const confere = (campo: string, a: unknown, b: unknown) => {
    if (texto(a) !== texto(b)) dif.push({ campo, banco: texto(a), stripe: texto(b) });
  };
  confere("status", banco.status, m.status);
  if (m.periodoFim) confere("fim do periodo", banco.periodoFim, m.periodoFim);
  if (m.cancelaNoFimDoPeriodo !== undefined) confere("cancela no fim do periodo", banco.cancelaNoFimDoPeriodo, m.cancelaNoFimDoPeriodo);
  if (m.stripePrecoId) confere("preco", banco.stripePrecoId, m.stripePrecoId);
  if (m.temFormaDePagamento !== undefined) confere("tem cartao", banco.temFormaDePagamento, m.temFormaDePagamento);
  return dif;
}

export async function conferirMarca(opcoes: {
  clienteId: number;
  banco: AssinaturaDoBanco[];
  porta: Pick<PortaStripe, "lerAssinatura" | "assinaturasDaMarca">;
  corrigir: boolean;
  /** Passa a assinatura do Stripe pelo tratamento do aviso (grava no banco). */
  aplicar: (evento: EventoDoStripe) => Promise<unknown>;
}): Promise<LinhaDaConferencia[]> {
  const linhas: LinhaDaConferencia[] = [];
  const vistas = new Set<string>();

  async function corrigir(sub: Record<string, unknown>, id: string): Promise<boolean> {
    if (!opcoes.corrigir) return false;
    const evento: EventoDoStripe = { id: `conferir_${id}_${Date.now()}`, type: "customer.subscription.updated", created: Math.floor(Date.now() / 1000), data: { object: sub } };
    await opcoes.aplicar(evento);
    return true;
  }

  for (const linha of opcoes.banco) {
    vistas.add(linha.stripeAssinaturaId);
    const sub = await opcoes.porta.lerAssinatura(linha.stripeAssinaturaId);
    if (!sub) {
      linhas.push({ stripeAssinaturaId: linha.stripeAssinaturaId, situacao: "so-no-banco", diferencas: [{ campo: "assinatura", banco: "existe", stripe: "nao existe (ou nao e deste produto)" }], corrigida: false });
      continue;
    }
    const diferencas = compararComOBanco(linha, sub);
    const corrigida = diferencas.length > 0 ? await corrigir(sub, linha.stripeAssinaturaId) : false;
    linhas.push({ stripeAssinaturaId: linha.stripeAssinaturaId, situacao: diferencas.length > 0 ? "diferente" : "igual", diferencas, corrigida });
  }

  // As que o Stripe tem para a marca e o nosso banco nunca recebeu (um checkout cujo aviso se perdeu).
  for (const sub of await opcoes.porta.assinaturasDaMarca(opcoes.clienteId)) {
    const id = typeof sub.id === "string" ? sub.id : null;
    if (!id || vistas.has(id)) continue;
    const corrigida = await corrigir(sub, id);
    linhas.push({ stripeAssinaturaId: id, situacao: "so-no-stripe", diferencas: [{ campo: "assinatura", banco: "nao existe", stripe: `existe (${texto(sub.status)})` }], corrigida });
  }
  return linhas;
}

export function relatorioEmTexto(clienteId: number, linhas: LinhaDaConferencia[], corrigir: boolean): string {
  if (linhas.length === 0) return `Marca ${clienteId}: nenhuma assinatura no banco nem no Stripe.`;
  const partes = [`Marca ${clienteId}: ${linhas.length} assinatura(s).`];
  for (const l of linhas) {
    if (l.situacao === "igual") {
      partes.push(`  ${l.stripeAssinaturaId}: igual ao Stripe.`);
      continue;
    }
    partes.push(`  ${l.stripeAssinaturaId}: ${l.situacao}${l.corrigida ? " (banco acertado pelo Stripe)" : ""}`);
    for (const d of l.diferencas) partes.push(`    ${d.campo}: banco = ${d.banco}, Stripe = ${d.stripe}`);
  }
  const pendentes = linhas.filter((l) => l.situacao !== "igual" && !l.corrigida && l.situacao !== "so-no-banco").length;
  if (!corrigir && pendentes > 0) partes.push("Nada foi alterado. Rode de novo com --corrigir para acertar o banco pelo Stripe.");
  return partes.join("\n");
}
