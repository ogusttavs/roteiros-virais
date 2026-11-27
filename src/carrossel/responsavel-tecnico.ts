/** O tamanho máximo da linha do responsável técnico: o slide desenha uma linha só, em letra pequena. */
export const MAXIMO_RESPONSAVEL_TECNICO = 80;

export type ResultadoResponsavel = { ok: true; linha: string | null } | { ok: false; motivo: "longo" | "link" | "colchete" };

/**
 * Valida e limpa a linha do responsável técnico ("Dra. Maria Souza, CRO-SP 12345"). Vazia vira `null` (apaga). Recusa texto longo demais, link ou @ (a linha não é lugar de
 * divulgação) e colchete (colchete é o sinal de "falta preencher" do carrossel). Não confere o número do registro: o app nunca inventa nem verifica esse dado.
 */
export function validarResponsavelTecnico(entrada: unknown): ResultadoResponsavel {
  if (typeof entrada !== "string") return { ok: true, linha: null };
  const linha = entrada.replace(/\s+/g, " ").trim();
  if (!linha) return { ok: true, linha: null };
  if (linha.length > MAXIMO_RESPONSAVEL_TECNICO) return { ok: false, motivo: "longo" };
  if (/https?:|www\.|@|\.(com|net|org|br)\b/i.test(linha)) return { ok: false, motivo: "link" };
  if (/[\[\]]/.test(linha)) return { ok: false, motivo: "colchete" };
  return { ok: true, linha };
}
