/**
 * E43, item 0 (achado da prova com chave real do PR #102, conferida por Fable): `tipoConteudo`
 * fora da lista (`TIPOS_CONTEUDO`) reprovava a ficha inteira do vídeo em `extrairVideo` e
 * `extrairVideoSemFala`, igual ao achado do PR #101 com `formato`/`tipoAbertura`. A diferença é
 * que aqui não basta trocar o valor por um padrão (`.catch`): `serveDeModelo` também precisa ser
 * forçado para `false` quando `tipoConteudo` veio inventado, para nunca confiar num "true" que o
 * modelo escreveu junto de uma classificação que não existe (na dúvida, o vídeo entra na base mas
 * não vira modelo de roteiro). Como as duas correções precisam andar juntas, rodam aqui, antes do
 * schema Zod validar, em vez de um `.catch()` por campo (que não teria como ver os dois juntos).
 */
import { TIPOS_CONTEUDO } from "@/db/schema";

const TIPOS_CONTEUDO_VALIDOS = new Set<string>(TIPOS_CONTEUDO);

export function corrigirTipoConteudoInvalido(bruto: unknown): unknown {
  if (!bruto || typeof bruto !== "object" || !("tipoConteudo" in bruto)) return bruto;

  const dados = bruto as Record<string, unknown>;
  if (typeof dados.tipoConteudo === "string" && TIPOS_CONTEUDO_VALIDOS.has(dados.tipoConteudo)) {
    return bruto;
  }

  return { ...dados, tipoConteudo: "original", serveDeModelo: false };
}
