import { z } from "zod";

import { MOTIVOS_REPROVACAO, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";

import type { EsforcoIA, NivelIA } from "../tipos";

/**
 * A memória do cliente (E27, parte 2, item 2): a partir das reprovações dos
 * últimos 90 dias e das regras que já existem hoje (ativas e desativadas),
 * compila até 10 regras curtas, em português de gente, que substituem o
 * conjunto de regras ativas de origem "reprovacao" (`src/jobs/
 * aprender-cliente.ts` faz a consolidação por código: mantém `primeiraEm` e
 * soma `contagem` da regra que já existia, e nunca ressuscita uma regra
 * desativada, mesmo que o modelo a proponha de novo). O modelo só propõe a
 * frase e, quando der, o motivo de origem; a contagem de reprovações que
 * sustentam cada regra é calculada por código, não pelo modelo.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = "low";

const IDS_MOTIVO = MOTIVOS_REPROVACAO.map((m) => m.id) as [IdMotivoReprovacao, ...IdMotivoReprovacao[]];
const idMotivoEnum = z.enum(IDS_MOTIVO);

const regraProposta = z.object({
  /** Uma frase, em português de gente, sem jargão (o verificador confere). */
  regra: z.string(),
  /** O motivo de `MOTIVOS_REPROVACAO` mais ligado a esta regra; nulo quando ela veio só do texto livre. */
  motivoOrigem: idMotivoEnum.nullable(),
});

export const schema = z.object({
  regras: z.array(regraProposta).max(10),
});

export type SaidaAprenderCliente = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você lê os motivos que um cliente já deu para reprovar roteiros e resume o que dá para
aprender com isso, em regras curtas que os próximos roteiros dele devem seguir.

Regras duras:

1. No máximo 10 regras, cada uma em uma frase só, em português de gente comum, nunca em
   jargão de marketing ou de tecnologia. Escreva do jeito que você diria para alguém, não
   como uma especificação: "não começar com pergunta: comece mostrando", não "otimizar o
   gancho para maior retenção".
2. Cada regra precisa vir de um padrão real nas reprovações, nunca inventada. Se as
   reprovações não sustentam nada de específico, devolva uma lista vazia.
3. Quando um motivo estruturado explica bem a regra, cite esse motivo em "motivoOrigem".
   Quando a regra vier só do texto livre que o cliente escreveu, deixe "motivoOrigem" nulo.
4. Duas reprovações parecidas viram uma regra só, nunca duas regras quase iguais.
5. As regras que já estão ativas hoje continuam do jeito que estão, com a mesma frase,
   a não ser que uma reprovação nova mude o que elas dizem; não reescreva uma regra ativa só
   para variar a redação.
6. Nunca proponha de novo uma regra que a lista de regras desativadas já mostra: o cliente
   decidiu que aquilo não vale para ele, mesmo que uma reprovação pareça apontar de novo
   para lá.
7. Sem travessão, sem emoji, sem jargão em nenhuma regra.

Escreva em português do Brasil, com acentuação correta.`;
}

export function montarEntrada(dados: {
  reprovacoes: { motivos: string[]; motivoTexto: string | null; gancho: string; corpo: string }[];
  regrasAtivas: { regra: string; motivoOrigem: string | null }[];
  regrasDesativadas: { regra: string; motivoOrigem: string | null }[];
}): string {
  const listaReprovacoes =
    dados.reprovacoes.length > 0
      ? dados.reprovacoes
          .map(
            (r, i) =>
              `reprovação ${i + 1}: motivo(s) ${r.motivos.length > 0 ? r.motivos.join(", ") : "nenhum motivo estruturado"}` +
              (r.motivoTexto ? `; o que o cliente escreveu: "${r.motivoTexto}"` : "") +
              `\n  gancho reprovado: ${r.gancho}\n  corpo reprovado: ${r.corpo}`,
          )
          .join("\n\n")
      : "nenhuma reprovacao nos ultimos 90 dias";

  const listaAtivas =
    dados.regrasAtivas.length > 0
      ? dados.regrasAtivas.map((r) => `"${r.regra}"${r.motivoOrigem ? ` (motivo: ${r.motivoOrigem})` : ""}`).join("; ")
      : "nenhuma regra ativa ainda";

  const listaDesativadas =
    dados.regrasDesativadas.length > 0
      ? dados.regrasDesativadas
          .map((r) => `"${r.regra}"${r.motivoOrigem ? ` (motivo: ${r.motivoOrigem})` : ""}`)
          .join("; ")
      : "nenhuma regra desativada";

  return (
    `Reprovações dos últimos 90 dias:\n${listaReprovacoes}\n\n` +
    `Regras já ativas hoje (mantenha a frase, a não ser que precise mudar):\n${listaAtivas}\n\n` +
    `Regras que o cliente desativou (nunca proponha de novo):\n${listaDesativadas}`
  );
}
