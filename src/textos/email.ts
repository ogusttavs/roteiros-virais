import { config } from "@/lib/config";

/**
 * Lembrete diário do tema pronto (etapa 12, decisão 5 do `PROXIMO.md`). Sem
 * "de hoje" (ajuste da revisão da etapa 13, parte 2): o lembrete usa a
 * mesma regra de estabilidade de `/hoje`, então o tema mostrado pode ser de
 * ontem, e o texto não pode prometer algo que não é sempre verdade.
 *
 * V3, item 6: um e-mail por pessoa, listando as marcas dela com tema
 * pendente (uma marca só, ou várias). `nomesMarcas` sempre não vazio, quem
 * chama (`src/jobs/lembrete.ts`) só envia quando há pelo menos uma pendente.
 */
function listaMarcas(nomesMarcas: string[]): string {
  if (nomesMarcas.length === 1) return nomesMarcas[0];
  const todasMenosUltima = nomesMarcas.slice(0, -1).join(", ");
  const ultima = nomesMarcas[nomesMarcas.length - 1];
  return `${todasMenosUltima} e ${ultima}`;
}

export const textosEmail = {
  assuntoLembrete: "O seu tema está pronto para gravar",
  corpoLembrete: (nomesMarcas: string[]) =>
    nomesMarcas.length === 1
      ? `<p>O tema de <strong>${nomesMarcas[0]}</strong> está pronto para gravar.</p><p><a href="${config.appUrl}/hoje">abrir o painel</a></p>`
      : `<p>O tema está pronto para gravar em ${listaMarcas(nomesMarcas)}.</p><p><a href="${config.appUrl}/hoje">abrir o painel</a></p>`,
};
