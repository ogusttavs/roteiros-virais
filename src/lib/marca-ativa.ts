/**
 * O cookie assinado que guarda qual marca esta ativa na sessao (V3, item 2,
 * escopo 4.13). A assinatura e so blindagem contra adulteracao acidental; a
 * garantia de verdade e outra, `clienteDaSessaoAtual` (`src/servicos/clientes.ts`)
 * sempre confere que o usuario e membro da marca antes de abrir, nunca confia
 * no cookie sozinho (cookie adulterado, com id de marca que o usuario nao
 * pertence, cai na regra do "senao": a marca de acesso mais recente).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

import { config } from "@/lib/config";

export const NOME_COOKIE_MARCA_ATIVA = "marca_ativa";

/** Um ano: o cookie so perde validade se o usuario deixar de ser membro da marca guardada. */
export const OPCOES_COOKIE_MARCA_ATIVA = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

function assinar(valor: string): string {
  return createHmac("sha256", config.auth.secret).update(valor).digest("hex");
}

/** O valor pronto para gravar no cookie `marca_ativa`. */
export function valorCookieMarcaAtiva(clienteId: number): string {
  const valor = String(clienteId);
  return `${valor}.${assinar(valor)}`;
}

/**
 * `null` quando o cookie nao existe, esta corrompido ou foi adulterado (a
 * assinatura nao bate). Nao confere se o usuario e membro dessa marca, isso
 * e responsabilidade de quem chama (a verificacao de verdade e sempre no
 * banco, nunca so no cookie).
 */
export function lerClienteIdDoCookie(valorCookie: string | undefined): number | null {
  if (!valorCookie) return null;

  const separador = valorCookie.lastIndexOf(".");
  if (separador === -1) return null;

  const valor = valorCookie.slice(0, separador);
  const assinaturaRecebida = valorCookie.slice(separador + 1);
  const assinaturaEsperada = assinar(valor);

  const bufferRecebido = Buffer.from(assinaturaRecebida, "hex");
  const bufferEsperado = Buffer.from(assinaturaEsperada, "hex");
  if (bufferRecebido.length !== bufferEsperado.length || !timingSafeEqual(bufferRecebido, bufferEsperado)) {
    return null;
  }

  const clienteId = Number(valor);
  return Number.isInteger(clienteId) && clienteId > 0 ? clienteId : null;
}
