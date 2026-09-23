import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/**
 * Lembrete diário do tema pronto (etapa 12, decisão 5 do `PROXIMO.md`). Sem
 * "de hoje" (ajuste da revisão da etapa 13, parte 2): o lembrete usa a
 * mesma regra de estabilidade de `/hoje`, então o tema mostrado pode ser de
 * ontem, e o texto não pode prometer algo que não é sempre verdade.
 *
 * V3, item 6: um e-mail por pessoa, listando as marcas dela com tema
 * pendente (uma marca só, ou várias). `marcas` sempre não vazio, quem chama
 * (`src/jobs/lembrete.ts`) só envia quando há pelo menos uma pendente.
 *
 * V5, item 7: a casca (cor, fonte de sistema, logotipo) vem de
 * `casca-email.ts`; o texto abaixo não muda.
 *
 * V9b, item 4: quando uma marca tem plano colado para hoje, os itens do
 * plano (lugar e situação, uma linha cada) entram acima do texto de
 * sempre; o texto de sempre não muda, continua listando todas as marcas
 * pendentes, com ou sem plano.
 */
export type MarcaPendente = { nome: string; planoHoje: { lugar: string; situacao: string }[] };

function listaMarcas(nomesMarcas: string[]): string {
  if (nomesMarcas.length === 1) return nomesMarcas[0];
  const todasMenosUltima = nomesMarcas.slice(0, -1).join(", ");
  const ultima = nomesMarcas[nomesMarcas.length - 1];
  return `${todasMenosUltima} e ${ultima}`;
}

function blocoPlano(marcas: MarcaPendente[]): string {
  const comPlano = marcas.filter((marca) => marca.planoHoje.length > 0);
  if (comPlano.length === 0) return "";
  return comPlano
    .map((marca) => {
      const itens = marca.planoHoje.map((item) => `${item.lugar}: ${item.situacao}`).join("<br>");
      const titulo = marcas.length > 1 ? `<p><strong>${marca.nome}</strong></p>` : "";
      return `${titulo}<p>${itens}</p>`;
    })
    .join("");
}

export const textosEmail = {
  assuntoLembrete: "O seu tema está pronto para gravar",
  corpoLembrete: (marcas: MarcaPendente[]) => {
    const nomes = marcas.map((marca) => marca.nome);
    const textoDeSempre =
      nomes.length === 1
        ? `<p>O tema de <strong>${nomes[0]}</strong> está pronto para gravar.</p>`
        : `<p>O tema está pronto para gravar em ${listaMarcas(nomes)}.</p>`;
    return envolverEmail(
      `${blocoPlano(marcas)}${textoDeSempre}<p>${linkEmail(`${config.appUrl}/hoje`, "abrir o painel")}</p>`,
    );
  },
};
