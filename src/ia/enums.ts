import { z } from "zod";

/**
 * Enums Zod usados nos schemas de saida das tarefas. Ficam fora de
 * src/ia/prompts/ (que o checar-texto varre) porque os valores de
 * puxaPara sao os nomes internos de escopo-e-arquitetura.md 4.3, que
 * coincidem com jargao proibido em texto de tela (alcance, engajamento,
 * conversao nunca aparecem para o cliente, so os nomes da secao 5 de
 * briefing-e-rubricas.md: "mais gente te conhecer" e as outras duas).
 */
export const puxaParaEnum = z.enum(["alcance", "engajamento", "conversao"]);
