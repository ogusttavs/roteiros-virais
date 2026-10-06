import { FILAS } from "@/jobs/fila";

/**
 * As rotinas do sistema em língua de gente (E46 PR 3, `AdminJobs.dc.html`): cada uma junta as filas que fazem a mesma coisa. O nome técnico só aparece no detalhe.
 * Toda fila de `FILAS` está em exatamente uma rotina (provado em teste), para nenhuma sumir da tela.
 */
export type Rotina = { chave: string; titulo: string; faz: string; filas: string[] };

export const ROTINAS: Rotina[] = [
  { chave: "buscar", titulo: "Buscar vídeos novos", faz: "Procura, em cada rede, os vídeos novos das contas que a gente acompanha.", filas: [FILAS.coletaYoutube, FILAS.coletaApify, FILAS.coletaMeioDia, FILAS.contasBase, FILAS.metaContas, FILAS.metaHashtags, FILAS.descobertaInstagram] },
  { chave: "noticias", titulo: "Ler as notícias do ramo", faz: "Junta as notícias do dia de cada ramo.", filas: [FILAS.coletaNoticias] },
  { chave: "tendencias", titulo: "Ver o que está em alta no Brasil", faz: "Junta as buscas e os vídeos em alta no país, para todos os ramos, e põe o tema do momento no dia de cada ramo.", filas: [FILAS.tendenciasBrasil] },
  { chave: "pontuar", titulo: "Ver quais vídeos estão indo bem", faz: "Compara cada vídeo com a conta dele e separa os que passaram da média.", filas: [FILAS.pontuar, FILAS.vigilancia] },
  { chave: "transcrever", titulo: "Transcrever", faz: "Escreve o que é dito nos vídeos que passaram no filtro.", filas: [FILAS.transcrever] },
  { chave: "analisar", titulo: "Analisar os vídeos", faz: "Lê cada vídeo: assunto, abertura, estrutura e fechamento.", filas: [FILAS.extrair, FILAS.extrairColeta, FILAS.extrairAgora, FILAS.analisarVisual, FILAS.extrairSemFala] },
  { chave: "modelo", titulo: "Montar o modelo do ramo", faz: "Resume o que funciona em cada ramo, com exemplos reais.", filas: [FILAS.modeloNicho] },
  { chave: "temas", titulo: "Montar os temas do dia", faz: "Escolhe os três temas de cada ramo a partir do que subiu.", filas: [FILAS.temasDoDia] },
  { chave: "mercado", titulo: "Pesquisar o mercado de um ramo", faz: "Acha e confere as maiores contas de um ramo novo, e de novo todo mês.", filas: [FILAS.pesquisaDeSetor] },
  { chave: "lembrete", titulo: "Mandar o lembrete", faz: "Avisa cada pessoa, na hora dela, que o roteiro do dia está pronto.", filas: [FILAS.lembrete] },
  { chave: "curva", titulo: "Medir os vídeos postados", faz: "Segue o desempenho dos vídeos que as contas postaram.", filas: [FILAS.curvaCliente] },
  { chave: "marca", titulo: "Entender a marca", faz: "Lê o site e as redes da marca para ela confirmar o que entendemos.", filas: [FILAS.entenderMarca, FILAS.analisarPerfil] },
  { chave: "aprender", titulo: "Aprender com as reprovações", faz: "Transforma o que a pessoa reprovou em regras daquela conta.", filas: [FILAS.aprenderCliente] },
  { chave: "email", titulo: "Mandar o e-mail de acompanhamento", faz: "Resume o dia do sistema para quem acompanha.", filas: [FILAS.emailAcompanhamento] },
];

/** O nome de cada fila em língua de gente, com artigo, para dizer qual falhou ("a coleta do meio-dia falhou hoje às 12:00"). Toda fila tem um (provado em teste). */
export const NOME_DA_FILA: Record<string, string> = {
  [FILAS.coletaYoutube]: "a busca no YouTube",
  [FILAS.coletaApify]: "a coleta do TikTok e do Instagram",
  [FILAS.coletaMeioDia]: "a coleta do meio-dia",
  [FILAS.coletaNoticias]: "a leitura das notícias",
  [FILAS.tendenciasBrasil]: "a leitura do que está em alta no Brasil",
  [FILAS.contasBase]: "a base das contas novas",
  [FILAS.metaContas]: "a leitura do Instagram pela Meta",
  [FILAS.metaHashtags]: "a busca por hashtag na Meta",
  [FILAS.descobertaInstagram]: "a descoberta de contas no Instagram",
  [FILAS.pontuar]: "a pontuação dos vídeos",
  [FILAS.vigilancia]: "a lista de vigilância",
  [FILAS.transcrever]: "a transcrição",
  [FILAS.extrair]: "o lote de análise",
  [FILAS.extrairColeta]: "a busca do resultado da análise",
  [FILAS.extrairAgora]: "a análise imediata",
  [FILAS.analisarVisual]: "a análise das imagens",
  [FILAS.extrairSemFala]: "a análise dos vídeos sem fala",
  [FILAS.modeloNicho]: "o modelo do ramo",
  [FILAS.temasDoDia]: "os temas do dia",
  [FILAS.pesquisaDeSetor]: "a pesquisa do mercado",
  [FILAS.lembrete]: "o lembrete",
  [FILAS.curvaCliente]: "a medição dos vídeos postados",
  [FILAS.emailAcompanhamento]: "o e-mail de acompanhamento",
  [FILAS.aprenderCliente]: "o aprendizado com as reprovações",
  [FILAS.entenderMarca]: "a leitura da marca",
  [FILAS.analisarPerfil]: "a leitura do perfil",
};

/** "30 3 * * *" em língua de gente. O que não cabe nos formatos que o agendamento usa volta cru, para nunca mentir. */
export function quandoDoCron(cron: string): string {
  const [min, hora, dia, mes, semana] = cron.trim().split(/\s+/);
  const dois = (n: string) => n.padStart(2, "0");
  if (mes !== "*") return cron;
  if (hora === "*" && dia === "*" && semana === "*") return min === "0" ? "de hora em hora, em ponto" : `de hora em hora, aos ${min} minutos`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hora)) return cron;
  const horario = `${dois(hora)}:${dois(min)}`;
  if (dia === "*" && semana === "*") return `todo dia às ${horario}`;
  if (dia === "*" && /^\d$/.test(semana)) return `toda ${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][Number(semana)]} às ${horario}`.replace("toda domingo", "todo domingo").replace("toda segunda", "toda segunda-feira");
  if (/^\d+$/.test(dia) && semana === "*") return `todo dia ${dia} do mês às ${horario}`;
  return cron;
}
