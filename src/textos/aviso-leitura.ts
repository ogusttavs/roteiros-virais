import type { Plataforma } from "@/db/schema";
import type { CausaDaParada } from "@/servicos/leitura-parada";

import { envolverEmail } from "./casca-email";

/**
 * O e-mail do admin quando a leitura de uma rede para (23/10/2026: a transcrição do YouTube ficou 20 dias parada sem ninguém ver). Sai uma vez por dia enquanto durar, e diz o que parou,
 * desde quando e o que fazer. Texto interno (só o admin lê), mas as regras do projeto valem do mesmo jeito: sem travessão, sem emoji.
 */

const NOME_DA_REDE: Record<Plataforma, string> = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram" };

const O_QUE_PAROU: Record<CausaDaParada, string> = {
  "proxy sem trafego": "o proxy está sem tráfego (o pacote acabou)",
  "proxy recusou o acesso": "o proxy recusou o acesso",
  "proxy fora do ar": "o proxy não está respondendo",
  bloqueio: "o YouTube está barrando as leituras (bloqueio do robô ou o download pendurando)",
  "sem leitura": "todas as tentativas de leitura falharam",
};

/** Quando o proxy é o túnel do computador do Gustavo (`proxyEhTunel`), "fora do ar" quer dizer túnel fechado. */
function oQueFazer(causa: CausaDaParada, tunel: boolean): string {
  switch (causa) {
    case "proxy sem trafego":
      return "Recarregue o pacote do proxy com o fornecedor. Sem isso nenhum vídeo do YouTube nem do TikTok é lido.";
    case "proxy recusou o acesso":
      return "Confira a senha e o pacote de tráfego com o fornecedor do proxy e o YTDLP_PROXY da máquina.";
    case "proxy fora do ar":
      return tunel
        ? "O túnel do computador do Gustavo está fechado: veja se o computador está ligado e com internet e se a tarefa agendada Roteiros - tunel do YouTube está rodando. O log é o arquivo roteiros-tunel-youtube.log, na pasta LocalAppData do computador."
        : "Veja se o fornecedor do proxy está no ar e se a máquina alcança o endereço do proxy.";
    case "bloqueio":
      return "Veja se o yt-dlp da máquina está atualizado e se o proxy responde. Não há nada a pagar neste caso.";
    case "sem leitura":
      return "Veja o erro da última rodada da transcrição em Rotinas no admin: ele diz o que falhou nos vídeos tentados.";
  }
}

export type ParadaParaOAviso = { plataforma: Plataforma; causa: CausaDaParada; desde: Date; dias: number; /** o proxy é o túnel do computador (ver `proxyEhTunel`) */ proxyEhTunel?: boolean };

function desdeQuando(desde: Date, dias: number): string {
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(desde);
  if (dias <= 0) return `desde hoje (${dia})`;
  return `desde ${dia}, há ${dias === 1 ? "1 dia" : `${dias} dias`}`;
}

function redes(paradas: ParadaParaOAviso[]): string {
  const nomes = [...new Set(paradas.map((p) => NOME_DA_REDE[p.plataforma]))];
  return nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export const textosAvisoDeLeitura = {
  assunto: (paradas: ParadaParaOAviso[]) => `A leitura de vídeos parou: ${redes(paradas)}`,
  titulo: (paradas: ParadaParaOAviso[]) => (paradas.length === 1 ? "A leitura de vídeos de uma rede parou." : "A leitura de vídeos de mais de uma rede parou."),
  /** O bloco de uma rede: o que parou, desde quando e o que fazer. */
  bloco: (p: ParadaParaOAviso) =>
    `<p><strong>${NOME_DA_REDE[p.plataforma]}</strong>: ${O_QUE_PAROU[p.causa]}, ${desdeQuando(p.desde, p.dias)}.</p><p>O que fazer: ${oQueFazer(p.causa, p.proxyEhTunel === true)}</p>`,
  rodape:
    "Enquanto isso, a fila de leitura deixa de gastar as vagas da noite com a rede parada e lê só as que funcionam. Ela tenta uma leitura de prova por noite na rede parada e volta sozinha quando a leitura funcionar. Este aviso sai uma vez por dia enquanto durar.",
  corpo: (paradas: ParadaParaOAviso[], enderecoDoAdmin: string) =>
    envolverEmail(
      `<p><strong>${textosAvisoDeLeitura.titulo(paradas)}</strong></p>${paradas.map(textosAvisoDeLeitura.bloco).join("")}<p>${textosAvisoDeLeitura.rodape}</p><p><a href="${enderecoDoAdmin}">Abrir o Início do admin</a></p>`,
    ),
};
