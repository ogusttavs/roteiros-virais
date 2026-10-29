import { FILAS } from "@/jobs/fila";

/**
 * As rotinas do sistema em língua de gente (E46 PR 3, `AdminJobs.dc.html`): cada uma junta as filas que fazem a mesma coisa. O nome técnico só aparece no detalhe.
 * Toda fila de `FILAS` está em exatamente uma rotina (provado em teste), para nenhuma sumir da tela.
 */
export type Rotina = { chave: string; titulo: string; faz: string; filas: string[] };

export const ROTINAS: Rotina[] = [
  { chave: "buscar", titulo: "Buscar vídeos novos", faz: "Procura, em cada rede, os vídeos novos das contas que a gente acompanha.", filas: [FILAS.coletaYoutube, FILAS.coletaApify, FILAS.coletaMeioDia, FILAS.contasBase, FILAS.metaContas, FILAS.metaHashtags, FILAS.descobertaInstagram] },
  { chave: "foco", titulo: "Pesquisar o assunto de cada conta", faz: "Para a conta que tem foco, busca no YouTube vídeos do assunto dela (e de alguns canais de referência), dentro de um teto por conta, para o ramo ter prova do que ela fala.", filas: [FILAS.pesquisaDoFoco] },
  { chave: "capas", titulo: "Guardar a capa dos vídeos", faz: "Baixa a imagem de capa dos vídeos do Instagram enquanto o link da rede ainda abre, para a referência não aparecer vazia depois.", filas: [FILAS.guardarCapas] },
  { chave: "noticias", titulo: "Ler as notícias do ramo", faz: "Junta as notícias do dia de cada ramo, separa as que importam para quem tem negócio ali e guarda a foto de cada matéria.", filas: [FILAS.coletaNoticias, FILAS.filtrarNoticias] },
  { chave: "tendencias", titulo: "Ver o que está em alta no Brasil", faz: "Junta as buscas e os vídeos em alta no país, para todos os ramos, e põe o tema do momento no dia de cada ramo.", filas: [FILAS.tendenciasBrasil] },
  { chave: "pontuar", titulo: "Ver quais vídeos estão indo bem", faz: "Compara cada vídeo com a conta dele e separa os que passaram da média.", filas: [FILAS.pontuar, FILAS.vigilancia] },
  { chave: "contas", titulo: "Conferir se as contas são do ramo", faz: "Uma vez por semana, olha os vídeos mais vistos de cada conta e tira do ramo (sem apagar nada) a que fala de outro assunto, para ela deixar de aparecer como referência, tema e o que o público pergunta.", filas: [FILAS.faxinaDeContas] },
  { chave: "transcrever", titulo: "Transcrever", faz: "Escreve o que é dito nos vídeos que passaram no filtro.", filas: [FILAS.transcrever] },
  { chave: "analisar", titulo: "Analisar os vídeos", faz: "Lê cada vídeo: assunto, abertura, estrutura e fechamento.", filas: [FILAS.extrair, FILAS.extrairColeta, FILAS.extrairAgora, FILAS.analisarVisual, FILAS.extrairSemFala] },
  { chave: "publico", titulo: "Ler o que o público comenta", faz: "Lê os comentários dos vídeos mais vistos de cada ramo e junta o que o público pergunta, reclama e pede.", filas: [FILAS.comentariosSemana] },
  { chave: "longos", titulo: "Ler os vídeos longos", faz: "Uma vez por semana, escreve o que é dito nos vídeos longos do YouTube que mais se destacaram em cada ramo e lê a estrutura deles (a abertura, os capítulos, onde a pessoa sairia).", filas: [FILAS.lerLongos] },
  { chave: "modelo", titulo: "Montar o modelo do ramo", faz: "Resume o que funciona em cada ramo, com exemplos reais.", filas: [FILAS.modeloNicho] },
  { chave: "temas", titulo: "Montar os temas do dia", faz: "Escolhe os três temas de cada ramo a partir do que subiu e, para a conta que tem foco, os três dela.", filas: [FILAS.temasDoDia] },
  { chave: "mercado", titulo: "Pesquisar o mercado de um ramo", faz: "Acha e confere as maiores contas de um ramo novo, e de novo todo mês.", filas: [FILAS.pesquisaDeSetor] },
  { chave: "lembrete", titulo: "Mandar o lembrete", faz: "Avisa cada pessoa, na hora dela, que o roteiro do dia está pronto.", filas: [FILAS.lembrete] },
  { chave: "curva", titulo: "Medir os vídeos postados", faz: "Segue o desempenho dos vídeos que as contas postaram.", filas: [FILAS.curvaCliente] },
  { chave: "marca", titulo: "Entender a marca", faz: "Lê o site e as redes da marca para ela confirmar o que entendemos.", filas: [FILAS.entenderMarca, FILAS.analisarPerfil] },
  { chave: "pesquisa", titulo: "Pesquisar na hora para um vídeo", faz: "Busca, em portais grandes e órgãos oficiais, os dados de verdade que a pessoa pediu antes de escrever um roteiro.", filas: [FILAS.pesquisaNaHora] },
  { chave: "publicar", titulo: "Publicar no Instagram", faz: "Espera a Meta preparar o vídeo que a pessoa enviou e o publica no Instagram dela; depois liga o link do post ao roteiro.", filas: [FILAS.publicarInstagram] },
  { chave: "edicao", titulo: "Editar os vídeos das pessoas", faz: "Escreve o que a pessoa falou no vídeo que enviou para editar (com a hora de cada palavra), decide o que fica no vídeo (cortes, título e legenda) e confere o resultado e, de hora em hora, apaga os vídeos que passaram do prazo de guarda: o bruto em 48 horas e o editado em 7 dias.", filas: [FILAS.transcreverEdicao, FILAS.decidirEdicao, FILAS.limparEdicoes] },
  { chave: "disco", titulo: "Vigiar o espaço do servidor", faz: "A cada 15 minutos mede quanto do disco está usado e avisa por e-mail quando passa de 80% (atenção) e de 90% (crítico). No crítico, o envio de vídeos para editar fica pausado e a limpeza roda na hora.", filas: [FILAS.vigiarDisco] },
  { chave: "aprender", titulo: "Aprender com as reprovações", faz: "Transforma o que a pessoa reprovou em regras daquela conta.", filas: [FILAS.aprenderCliente] },
  { chave: "faxina", titulo: "Limpar as versões que ninguém escolheu", faz: "Apaga as versões de roteiro que ficaram sem escolha em grupos parados há mais de 30 dias.", filas: [FILAS.faxinaVersoes] },
  { chave: "instagram-ligado", titulo: "Renovar o acesso dos Instagram ligados", faz: "Renova, antes de vencer, o acesso que as pessoas deram ao próprio Instagram, e avisa o dono da conta quando não dá mais para renovar.", filas: [FILAS.renovarContasLigadas] },
  { chave: "email", titulo: "Mandar o e-mail de acompanhamento", faz: "Resume o dia do sistema para quem acompanha.", filas: [FILAS.emailAcompanhamento] },
];

/** O nome de cada fila em língua de gente, com artigo, para dizer qual falhou ("a coleta do meio-dia falhou hoje às 12:00"). Toda fila tem um (provado em teste). */
export const NOME_DA_FILA: Record<string, string> = {
  [FILAS.coletaYoutube]: "a busca no YouTube",
  [FILAS.coletaApify]: "a coleta do TikTok e do Instagram",
  [FILAS.coletaMeioDia]: "a coleta do meio-dia",
  [FILAS.coletaNoticias]: "a leitura das notícias",
  [FILAS.filtrarNoticias]: "a escolha das notícias que importam",
  [FILAS.tendenciasBrasil]: "a leitura do que está em alta no Brasil",
  [FILAS.contasBase]: "a base das contas novas",
  [FILAS.metaContas]: "a leitura do Instagram pela Meta",
  [FILAS.metaHashtags]: "a busca por hashtag na Meta",
  [FILAS.descobertaInstagram]: "a descoberta de contas no Instagram",
  [FILAS.guardarCapas]: "a guarda das capas dos vídeos",
  [FILAS.pontuar]: "a pontuação dos vídeos",
  [FILAS.vigilancia]: "a lista de vigilância",
  [FILAS.faxinaDeContas]: "a conferência das contas do ramo",
  [FILAS.transcrever]: "a transcrição",
  [FILAS.extrair]: "o lote de análise",
  [FILAS.extrairColeta]: "a busca do resultado da análise",
  [FILAS.extrairAgora]: "a análise imediata",
  [FILAS.analisarVisual]: "a análise das imagens",
  [FILAS.comentariosSemana]: "a leitura dos comentários do público",
  [FILAS.lerLongos]: "a leitura dos vídeos longos",
  [FILAS.extrairSemFala]: "a análise dos vídeos sem fala",
  [FILAS.modeloNicho]: "o modelo do ramo",
  [FILAS.temasDoDia]: "os temas do dia",
  [FILAS.pesquisaDeSetor]: "a pesquisa do mercado",
  [FILAS.pesquisaDoFoco]: "a pesquisa do assunto de cada conta",
  [FILAS.lembrete]: "o lembrete",
  [FILAS.curvaCliente]: "a medição dos vídeos postados",
  [FILAS.emailAcompanhamento]: "o e-mail de acompanhamento",
  [FILAS.faxinaVersoes]: "a limpeza das versões",
  [FILAS.renovarContasLigadas]: "a renovação do acesso aos Instagram ligados",
  [FILAS.aprenderCliente]: "o aprendizado com as reprovações",
  [FILAS.entenderMarca]: "a leitura da marca",
  [FILAS.analisarPerfil]: "a leitura do perfil",
  [FILAS.pesquisaNaHora]: "a pesquisa na hora",
  [FILAS.publicarInstagram]: "a publicação no Instagram",
  [FILAS.transcreverEdicao]: "a leitura da fala do vídeo para editar",
  [FILAS.decidirEdicao]: "a decisão da edição do vídeo",
  [FILAS.limparEdicoes]: "a limpeza dos vídeos guardados para editar",
  [FILAS.vigiarDisco]: "a vigia do espaço do servidor",
};

/** "30 3 * * *" em língua de gente. O que não cabe nos formatos que o agendamento usa volta cru, para nunca mentir. */
export function quandoDoCron(cron: string): string {
  const [min, hora, dia, mes, semana] = cron.trim().split(/\s+/);
  const dois = (n: string) => n.padStart(2, "0");
  if (mes !== "*") return cron;
  const aCada = /^\*\/(\d{1,2})$/.exec(min);
  if (aCada && hora === "*" && dia === "*" && semana === "*") return `a cada ${aCada[1]} minutos`;
  if (hora === "*" && dia === "*" && semana === "*") return min === "0" ? "de hora em hora, em ponto" : `de hora em hora, aos ${min} minutos`;
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hora)) return cron;
  const horario = `${dois(hora)}:${dois(min)}`;
  if (dia === "*" && semana === "*") return `todo dia às ${horario}`;
  if (dia === "*" && /^\d$/.test(semana)) return `toda ${["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][Number(semana)]} às ${horario}`.replace("toda domingo", "todo domingo").replace("toda segunda", "toda segunda-feira");
  if (/^\d+$/.test(dia) && semana === "*") return `todo dia ${dia} do mês às ${horario}`;
  return cron;
}
