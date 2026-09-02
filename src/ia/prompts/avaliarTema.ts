import { z } from "zod";

/**
 * Nota de tema em cinco pilares (briefing-e-rubricas.md, secao 6, texto
 * literal) mais as regras duras da secao 7. Ancorada em evidencia: o
 * sistema busca os videos e entrega a IA, que so pode citar o que recebeu.
 */
export const versao = "1.0.0";

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

export function montarSistemaEstavel(dados: {
  perfilCompilado: string;
  modeloNicho: string;
}): string {
  return `Voce avalia um tema de video proposto por um dono de pequeno negocio, em cinco
pilares de 0 a 10, cada um com uma frase de justificativa. A nota final e a media simples
dos cinco. Abaixo de 9,0 recomende ajustar e sugira o angulo mais proximo que tem evidencia
no banco. So cite evidencia (ids de video) que estiver na lista que voce recebeu; sem
evidencia, diga isso com clareza e sugira o vizinho mais perto.

Os cinco pilares:
- Chance de viralizar: tres ou mais videos fora da curva (3x a mediana da conta ou mais)
  sobre o assunto nos ultimos 90 dias valem 9 a 10. Um ou dois valem 7 a 8. So assuntos
  vizinhos valem 5 a 6. Nenhum vale 4 ou menos, e diga isso.
- Chance de gerar cliente: responde um medo ou pergunta pre compra do cliente vale 9 a 10.
  Educa sobre o servico vale 7 a 8. Curiosidade ou entretenimento sem ligacao com a compra
  vale 6 ou menos.
- Encaixe com voce: usa a autoridade dele, fala com o cliente dele e cabe no tom dele. Fere
  uma proibicao do briefing vale 3 ou menos.
- Novidade: o mesmo angulo ja apareceu tres vezes ou mais na evidencia vale 5 ou menos.
  Angulo novo sobre assunto quente vale 9 a 10.
- Facilidade de gravar: da para gravar sozinho, no celular, hoje, no lugar dele vale 9 a
  10. Precisa de outra pessoa, objeto que ele nao tem ou edicao dificil cai
  proporcionalmente.

Regras duras que valem aqui tambem: todo tema cita a evidencia que sustenta ele; sem
travessao, sem emoji, sem jargao na justificativa nem na recomendacao.

Perfil do cliente:
${dados.perfilCompilado}

Modelo do nicho:
${dados.modeloNicho}`;
}

export function montarEntrada(dados: {
  tema: string;
  evidencias: { id: number; assunto: string; foraDaCurva: number }[];
}): string {
  const listaEvidencias =
    dados.evidencias.length > 0
      ? dados.evidencias
          .map((v) => `id ${v.id}: ${v.assunto} (fora da curva ${v.foraDaCurva.toFixed(1)}x)`)
          .join("\n")
      : "nenhuma evidencia encontrada nos ultimos 90 dias";

  return `Tema proposto: ${dados.tema}\n\nEvidencia disponivel:\n${listaEvidencias}`;
}
