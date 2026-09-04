import { z } from "zod";

import type { Persona } from "@/db/schema";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * Nota de tema em cinco pilares (briefing-e-rubricas.md, secao 6, texto
 * literal) mais as regras duras da secao 7 e a persona da secao 5. Ancorada
 * em evidencia: o sistema busca os videos e entrega a IA, que so pode citar
 * o que recebeu.
 */
export const versao = "1.2.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "high";

const notaPilar = z.object({ nota: z.number().min(0).max(10), justificativa: z.string() });

export const schema = z.object({
  pilares: z.object({
    viralizar: notaPilar,
    gerarCliente: notaPilar,
    encaixe: notaPilar,
    novidade: notaPilar,
    facilidade: notaPilar,
  }),
  nota: z.number().min(0).max(10),
  recomendacao: z.string(),
  anguloSugerido: z.string().nullable(),
  evidencias: z.array(z.number()),
});

export type SaidaAvaliarTema = z.infer<typeof schema>;

function textoPersona(persona: Persona): string {
  return persona === "criador"
    ? "Este cliente quer virar criador e atrair marcas, não vender o próprio produto ou serviço."
    : "Este cliente quer vender o próprio produto ou serviço, não virar criador.";
}

export function montarSistemaEstavel(dados: {
  perfilCompilado: string;
  modeloNicho: string;
  persona: Persona;
}): string {
  return `Você avalia um tema de vídeo proposto por um dono de pequeno negócio, em cinco
pilares de 0 a 10, cada um com uma frase de justificativa. A nota final é a média simples
dos cinco. Abaixo de 9,0 recomende ajustar e sugira o ângulo mais próximo que tem evidência
no banco. Só cite evidência (ids de vídeo) que estiver na lista que você recebeu; sem
evidência, diga isso com clareza e sugira o vizinho mais perto.

Os cinco pilares:
- Chance de viralizar: três ou mais vídeos fora da curva (3x a mediana da conta ou mais)
  sobre o assunto nos últimos 90 dias valem 9 a 10. Um ou dois valem 7 a 8. Só assuntos
  vizinhos valem 5 a 6. Nenhum vale 4 ou menos, e diga isso.
- Chance de gerar cliente: responde um medo ou pergunta pré compra do cliente vale 9 a 10.
  Educa sobre o serviço vale 7 a 8. Curiosidade ou entretenimento sem ligação com a compra
  vale 6 ou menos. Para quem escolheu virar criador, gerar cliente significa virar candidato
  a parceria paga: o vídeo que constrói o interesse de uma marca do nicho vale 9 a 10, o que
  só entretém sem construir esse interesse vale 6 ou menos.
- Encaixe com você: usa a autoridade dele, fala com o cliente dele e cabe no tom dele. Fere
  uma proibição do briefing vale 3 ou menos.
- Novidade: o mesmo ângulo já apareceu três vezes ou mais na evidência vale 5 ou menos.
  Ângulo novo sobre assunto quente vale 9 a 10.
- Facilidade de gravar: dá para gravar sozinho, no celular, hoje, no lugar dele vale 9 a
  10. Precisa de outra pessoa, objeto que ele não tem ou edição difícil cai
  proporcionalmente.

Regras duras que valem aqui também: todo tema cita a evidência que sustenta ele; sem
travessão, sem emoji, sem jargão na justificativa nem na recomendação.

${textoPersona(dados.persona)}

Perfil do cliente:
${dados.perfilCompilado}

Modelo do nicho:
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  tema: string;
  evidencias: { id: number; assunto: string; gancho: string; foraDaCurva: number }[];
}): string {
  const listaEvidencias =
    dados.evidencias.length > 0
      ? dados.evidencias
          .map((v) => `id ${v.id}: ${v.assunto}, gancho "${v.gancho}" (fora da curva ${v.foraDaCurva.toFixed(1)}x)`)
          .join("\n")
      : "nenhuma evidencia encontrada nos ultimos 90 dias";

  return `Tema proposto: ${dados.tema}\n\nEvidencia disponivel:\n${listaEvidencias}`;
}
