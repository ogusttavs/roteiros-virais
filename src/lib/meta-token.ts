/**
 * E19 PR 1: o token de acesso de cada conta ligada nunca fica no banco em texto. Aqui ele é cifrado com AES-256-GCM (chave de 32 bytes em `META_TOKEN_CHAVE`) e decifrado só na hora
 * de chamar a Graph API. Formato guardado: `v1.<iv>.<etiqueta>.<texto cifrado>`, tudo em base64url. O GCM autentica o texto: um byte trocado no banco faz a decifragem falhar em vez de
 * devolver lixo.
 *
 * O "contexto" entra como dado autenticado (AAD): é a identidade de quem é dono do token (marca, plataforma e conta). Um valor cifrado copiado de uma linha para outra, de uma marca
 * para a de outra, não decifra: a etiqueta não bate. É uma segunda trava do isolamento entre marcas, além do filtro por `cliente_id` nas consultas.
 *
 * Nada aqui escreve o token ou a chave em log, em mensagem de erro ou em retorno de erro.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { bytesDaChaveDoToken, config } from "@/lib/config";

const VERSAO = "v1";

/** Falha de chave ou de decifragem. A mensagem não leva o token nem a chave. */
export class ErroTokenCifrado extends Error {}

/** O contexto que amarra o token à sua dona. Mesmo texto ao cifrar e ao decifrar. */
export function contextoDoToken(clienteId: number, plataforma: string, contaId: string): string {
  return `conta-conectada:${clienteId}:${plataforma}:${contaId}`;
}

function chave(): Buffer {
  const bytes = bytesDaChaveDoToken(config.metaConexao.tokenChave);
  if (!bytes) throw new ErroTokenCifrado("META_TOKEN_CHAVE nao esta definida ou nao tem 32 bytes.");
  return bytes;
}

export function cifrarToken(token: string, contexto: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  cifra.setAAD(Buffer.from(contexto, "utf8"));
  const cifrado = Buffer.concat([cifra.update(token, "utf8"), cifra.final()]);
  return [VERSAO, iv.toString("base64url"), cifra.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(".");
}

export function decifrarToken(valor: string, contexto: string): string {
  const partes = valor.split(".");
  if (partes.length !== 4 || partes[0] !== VERSAO) throw new ErroTokenCifrado("O token guardado nao esta no formato esperado.");
  try {
    const decifra = createDecipheriv("aes-256-gcm", chave(), Buffer.from(partes[1], "base64url"));
    decifra.setAAD(Buffer.from(contexto, "utf8"));
    decifra.setAuthTag(Buffer.from(partes[2], "base64url"));
    return Buffer.concat([decifra.update(Buffer.from(partes[3], "base64url")), decifra.final()]).toString("utf8");
  } catch (erro) {
    if (erro instanceof ErroTokenCifrado) throw erro;
    // Chave trocada, valor adulterado ou copiado de outra dona: a mesma resposta para os tres, sem detalhe do erro de baixo nivel.
    throw new ErroTokenCifrado("Nao foi possivel decifrar o token guardado (chave diferente, valor alterado ou de outra conta).");
  }
}
