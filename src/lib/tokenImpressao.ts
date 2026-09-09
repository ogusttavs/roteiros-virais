/**
 * Token de uso interno para `/roteiros/[id]/imprimir` (achado do primeiro
 * uso no iPad, item 5, PDF): a página que vira PDF é gerada num navegador
 * sem sessão (a rota `/api/roteiros/[id]/pdf` abre essa página com o
 * Playwright, dentro do próprio servidor), então ela não pode exigir o
 * cookie de sessão do better-auth. O token, assinado com o mesmo segredo da
 * sessão, válido por 1 minuto, só para o próprio servidor: tempo de sobra
 * para o Playwright navegar, sem nascer numa requisição do navegador do
 * cliente (ajuste da revisão do PR #33, item 5: o texto antigo dizia "uso
 * único" e "nunca reaproveitável", mas não há registro de consumo, então o
 * mesmo token vale para mais de uma navegação dentro do minuto).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "./config";

const VALIDADE_MS = 60_000;

function assinar(roteiroId: number, clienteId: number, expiraEm: number): string {
  return createHmac("sha256", config.auth.secret)
    .update(`${roteiroId}.${clienteId}.${expiraEm}`)
    .digest("hex");
}

export function criarTokenImpressao(roteiroId: number, clienteId: number): string {
  const expiraEm = Date.now() + VALIDADE_MS;
  const assinatura = assinar(roteiroId, clienteId, expiraEm);
  return `${clienteId}.${expiraEm}.${assinatura}`;
}

/** `null` para token ausente, malformado, expirado, ou assinado para outro roteiro. */
export function validarTokenImpressao(
  token: string,
  roteiroId: number,
): { clienteId: number } | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  const [clienteIdTexto, expiraEmTexto, assinatura] = partes;
  const clienteId = Number(clienteIdTexto);
  const expiraEm = Number(expiraEmTexto);
  if (!Number.isFinite(clienteId) || !Number.isFinite(expiraEm)) return null;
  if (Date.now() > expiraEm) return null;

  const esperada = Buffer.from(assinar(roteiroId, clienteId, expiraEm));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  return { clienteId };
}
