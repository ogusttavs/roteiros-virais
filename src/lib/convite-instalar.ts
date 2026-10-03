/**
 * O convite de instalar o aplicativo no celular (E48 PR 1): quando ele vale e como o aparelho é reconhecido. Sem banco nem navegador de propósito,
 * para o servidor (que decide se manda a folha) e o cliente (que decide o que ela mostra) usarem a mesma regra e o teste não precisar de nenhum dos dois.
 */

/** "Agora não" adia o convite por sete dias (decisão do Gustavo de 03/10/2026). */
export const DIAS_DE_ADIAMENTO_DO_CONVITE = 7;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Quando o "agora não" de hoje deixa de valer. */
export function adiamentoDoConvite(agora: Date): Date {
  return new Date(agora.getTime() + DIAS_DE_ADIAMENTO_DO_CONVITE * DIA_MS);
}

/**
 * A folha de convite pode aparecer para esta pessoa? Não quando o aplicativo já foi aberto instalado (nunca mais) nem enquanto um "agora não"
 * ainda vale. O resto (ser celular, não estar instalado neste aparelho agora, o roteiro já estar na tela) só o navegador sabe.
 */
export function conviteDeInstalarPodeAparecer(
  preferencias: { instaladoEm: Date | null; conviteInstalarAdiadoAte: Date | null } | null,
  agora: Date,
): boolean {
  if (!preferencias) return true;
  if (preferencias.instaladoEm) return false;
  if (preferencias.conviteInstalarAdiadoAte && preferencias.conviteInstalarAdiadoAte > agora) return false;
  return true;
}

export type SistemaDoAparelho = "iphone" | "android" | "outro";

/**
 * O sistema do celular, pelo `User-Agent`: o convite só existe no iPhone (Safari) e no Android. Tudo o mais (computador, tablet de desktop,
 * navegador desconhecido) é "outro" e não recebe nada. O iPad novo se apresenta como Mac e fica de fora de propósito (o convite é do celular).
 */
export function sistemaDoAparelho(userAgent: string): SistemaDoAparelho {
  if (/iPhone|iPod/i.test(userAgent)) return "iphone";
  if (/Android/i.test(userAgent) && /Mobile/i.test(userAgent)) return "android";
  return "outro";
}
