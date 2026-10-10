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
 *
 * E39a, item 7: quando uma marca já tem algo marcado na Agenda de hoje
 * (reels ou story, de qualquer um dos quatro caminhos de Criar, não só do
 * plano colado), a lista entra entre o plano e o texto de sempre.
 *
 * E39b, item (c): quando a marca tem algo atrasado (marcado para um dia que já passou e continua
 * "a gravar"), a lista entra antes de tudo, por ser o mais urgente.
 */
export type ItemAgendaPendente = { titulo: string; status: "gerado" | "gravado" | "postado" };
export type MarcaPendente = {
  nome: string;
  /** E55 PR 2c: o assunto do momento do ramo da marca hoje e o título do tema trazido para o ramo; ausente quando o ramo não tem tema do momento. */
  emAlta?: { assunto: string; tituloDoTema: string } | null;
  atrasados: string[];
  planoHoje: { lugar: string; situacao: string }[];
  agendaHoje: ItemAgendaPendente[];
};

const ROTULO_ESTADO_AGENDA: Record<ItemAgendaPendente["status"], string> = {
  gerado: "a gravar",
  gravado: "gravado",
  postado: "postado",
};

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
      const itens = marca.planoHoje.map((item) => `${escaparHtml(item.lugar)}: ${escaparHtml(item.situacao)}`).join("<br>");
      const titulo = marcas.length > 1 ? `<p><strong>${escaparHtml(marca.nome)}</strong></p>` : "";
      return `${titulo}<p>${itens}</p>`;
    })
    .join("");
}

function blocoAtrasado(marcas: MarcaPendente[]): string {
  const comAtrasado = marcas.filter((marca) => marca.atrasados.length > 0);
  if (comAtrasado.length === 0) return "";
  return comAtrasado
    .map((marca) => {
      const itens = marca.atrasados.map(escaparHtml).join("<br>");
      const titulo = marcas.length > 1 ? `<p><strong>${escaparHtml(marca.nome)}: atrasado</strong></p>` : "<p><strong>Atrasado</strong></p>";
      return `${titulo}<p>${itens}</p>`;
    })
    .join("");
}

function blocoAgenda(marcas: MarcaPendente[]): string {
  const comAgenda = marcas.filter((marca) => marca.agendaHoje.length > 0);
  if (comAgenda.length === 0) return "";
  return comAgenda
    .map((marca) => {
      const itens = marca.agendaHoje
        .map((item) => `${escaparHtml(item.titulo)} (${ROTULO_ESTADO_AGENDA[item.status]})`)
        .join("<br>");
      const titulo = marcas.length > 1 ? `<p><strong>${escaparHtml(marca.nome)}</strong></p>` : "";
      return `${titulo}<p>${itens}</p>`;
    })
    .join("");
}

/** O assunto vem de um feed público (Google, YouTube): nunca entra no HTML do e-mail sem escapar. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type MarcaComAlta = MarcaPendente & { emAlta: NonNullable<MarcaPendente["emAlta"]> };

/** As marcas da pessoa que têm o assunto do momento hoje, na ordem em que vêm (o lembrete as ordena pelo nome). A primeira dá o assunto do aviso. */
export function marcasComAssuntoDoMomento(marcas: MarcaPendente[]): MarcaComAlta[] {
  return marcas.filter((marca): marca is MarcaComAlta => Boolean(marca.emAlta));
}

export const textosEmail = {
  assuntoLembrete: "O seu tema está pronto para gravar",
  /** E55 PR 2c: com o assunto do momento no ramo de uma das marcas, o assunto do e-mail é ele (a mesma frase do push). */
  assuntoDoLembrete: (marcas: MarcaPendente[]): string => {
    const [primeira] = marcasComAssuntoDoMomento(marcas);
    return primeira ? `Em alta hoje: ${primeira.emAlta.assunto}` : textosEmail.assuntoLembrete;
  },
  corpoLembrete: (marcas: MarcaPendente[]) => {
    const comAlta = marcasComAssuntoDoMomento(marcas);
    // O assunto do momento vem na frente, antes de tudo: é a única coisa do dia que tem prazo. Uma linha por marca que o tem (cada ramo tem o seu tema), e a frase do prazo uma vez só; as outras marcas seguem com o texto de sempre.
    const blocoEmAlta =
      comAlta.length > 0
        ? `${comAlta
            .map((marca) => `<p><strong>Em alta hoje no Brasil: ${escaparHtml(marca.emAlta.assunto)}.</strong> Tem um tema pronto para ${escaparHtml(marca.nome)}: "${escaparHtml(marca.emAlta.tituloDoTema)}".</p>`)
            .join("")}<p>Ele vale enquanto o assunto estiver em alta. O roteiro sai em poucos minutos e é curto: dá para gravar no celular, hoje.</p>`
        : "";
    const nomes = marcas.filter((marca) => !comAlta.includes(marca as MarcaComAlta)).map((marca) => escaparHtml(marca.nome));
    const textoDeSempre =
      nomes.length === 0
        ? ""
        : nomes.length === 1
          ? `<p>O tema de <strong>${nomes[0]}</strong> está pronto para gravar.</p>`
          : `<p>O tema está pronto para gravar em ${listaMarcas(nomes)}.</p>`;
    return envolverEmail(
      `${blocoEmAlta}${blocoAtrasado(marcas)}${blocoPlano(marcas)}${blocoAgenda(marcas)}${textoDeSempre}<p>${linkEmail(`${config.appUrl}/hoje`, "abrir o painel")}</p>`,
    );
  },
};
