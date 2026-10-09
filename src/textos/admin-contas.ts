import type { EstadoDoDia } from "@/servicos/admin-contas";

/**
 * Textos do Início, da lista de Contas e da página da conta no admin (E46 PR 1, passo 15 do Opus: `AdminInicio.dc.html`, `AdminClientes.dc.html`, `AdminCliente.dc.html`).
 * O admin é da equipe, mas a regra é a mesma do resto: língua de gente, sem travessão e sem emoji.
 */

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "quinta-feira, 2 de outubro, 07:40" no horário do Brasil. */
export function dataEHoraPorExtenso(d: Date): string {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric", weekday: "short", hour12: false });
  const partes = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  const semana = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(d);
  const indice = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(semana);
  return `${DIAS[indice]}, ${Number(partes.day)} de ${MESES[Number(partes.month) - 1]}, ${partes.hour}:${partes.minute}`;
}

/** "hoje às 05:12", "ontem às 19:40" ou "28/09 às 08:00". */
export function quandoPorExtenso(d: Date, agora: Date = new Date()): string {
  const dia = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(x);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  if (dia(d) === dia(agora)) return `hoje às ${hora}`;
  if (dia(d) === dia(new Date(agora.getTime() - 24 * 60 * 60 * 1000))) return `ontem às ${hora}`;
  const curto = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
  return `${curto} às ${hora}`;
}

export function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function dolares(valor: number): string {
  return `US$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const textosInicioAdmin = {
  titulo: "Início",
  linhaDoDia: (quando: string, contas: number, ramos: number) => `${quando}. Hoje: ${contas === 1 ? "1 conta" : `${contas} contas`}, ${ramos === 1 ? "1 ramo" : `${ramos} ramos`}`,
  estado: {
    aria: "Esta manhã",
    atencao: (n: number) => (n === 1 ? "1 coisa pede atenção" : `${n} coisas pedem atenção`),
    certo: "Tudo certo esta manhã",
    nadaAindaMas: "Nada pede atenção por enquanto",
    aindaSemTemas: (semTemas: number, ramos: number) => (ramos === 0 ? "Nenhum ramo ativo ainda." : `Os temas de hoje ainda não saíram em ${semTemas} de ${ramos} ramos; a madrugada pode ainda estar rodando.`),
    tudoCertoLinha: (ramos: number) => `A madrugada rodou ${ramos === 1 ? "no único ramo" : `nos ${ramos} ramos`}, os temas de hoje saíram e nenhuma conta parou de gravar.`,
  },
  atencao: {
    rotinaGlobalErro: (quais: string[]) => ({ titulo: `Hoje deu erro em ${listar(quais)}`, detalhe: "vale para todos os ramos; veja em Rotinas" }),
    semTemas: (nomes: string[]) => ({ titulo: nomes.length === 1 ? `Os temas de hoje não saíram no ramo ${nomes[0]}` : `Os temas de hoje não saíram em ${nomes.length} ramos`, detalhe: listar(nomes) }),
    contasPararam: (n: number) => ({ titulo: n === 1 ? "1 conta parou de gravar há 4 dias ou mais" : `${n} contas pararam de gravar há 4 dias ou mais`, detalhe: "nada gerado nem aberto no período" }),
    // Hotfix do proxy (09/10/2026): o proxy do YouTube, comprado por gigabyte, acabou ou não responde. Sem ele nenhum vídeo do YouTube (nem do TikTok) é transcrito.
    proxyParado: (motivo: "proxy sem trafego" | "proxy fora do ar", desde: string) => ({
      titulo: motivo === "proxy sem trafego" ? "O proxy do YouTube está sem tráfego" : "O proxy do YouTube não está respondendo",
      detalhe: `desde ${desde}; nenhum vídeo do YouTube nem do TikTok é transcrito enquanto isso${motivo === "proxy sem trafego" ? "; recarregue o pacote no DataImpulse" : ""}`,
    }),
    pedidosDeRamo: (n: number) => ({ titulo: n === 1 ? "1 pedido de ramo espera você" : `${n} pedidos de ramo esperam você`, detalhe: "a pessoa não achou o ramo na lista" }),
    teto: (reaisHoje: string, teto: string) => ({ titulo: "O gasto de hoje passou do teto do dia", detalhe: `${reaisHoje} de ${teto}` }),
    errosContinuam: (n: number) => ({ titulo: n === 1 ? "1 rotina com erro continua sem rodar certo" : `${n} rotinas com erro continuam sem rodar certo`, detalhe: "o último erro de cada uma segue sem uma execução boa depois" }),
    verRotinas: "Ver em Rotinas",
    verContas: "Ver as contas",
    verRamos: "Ver os pedidos",
    verCustos: "Ver em Custos",
  },
  madrugada: {
    titulo: "A madrugada",
    legenda: "da busca de vídeos aos temas de hoje",
    verRotinas: "Ver em Rotinas",
    resumoOk: (n: number) => (n === 1 ? "ramo sem problema" : "ramos sem problema"),
    resumoProblema: "com algo que não saiu",
    colunas: { ramo: "Ramo", busca: "Busca", transcricao: "Transcrição", analise: "Análise", temas: "Temas" },
    vazio: "Nenhum ramo ativo ainda.",
    videos: (n: number) => (n === 1 ? "1 vídeo" : `${n} vídeos`),
    transcritos: (n: number) => (n === 1 ? "1 transcrito" : `${n} transcritos`),
    deuErro: "deu erro",
    rotinasDeHoje: "Rotinas de hoje, para todos os ramos",
    buscaGlobal: "a busca de vídeos",
    transcricaoGlobal: "a transcrição",
    estadoRotina: { ok: "rodou", erro: "deu erro", rodando: "rodando agora", sem_execucao: "ainda não rodou" } as Record<string, string>,
    naoSaiu: "não saiu",
    aindaNao: "ainda não",
  },
  erros: {
    titulo: "Os últimos erros",
    hoje: (n: number) => (n === 0 ? "nenhum hoje" : n === 1 ? "1 hoje" : `${n} hoje`),
    nenhum: "Nenhum erro de rotina registrado.",
    verTodos: "Ver todos",
    continua: "continua",
    resolvido: "resolvido",
    frase: (nome: string, mensagem: string) => `A rotina ${nome} não terminou${mensagem ? `: ${mensagem}` : "."}`,
  },
  dinheiro: {
    titulo: "O dinheiro",
    verCustos: "Ver em Custos",
    saiuHoje: "Saiu hoje",
    saiuHojeDetalhe: (dolar: string, teto: string) => `${dolar}, de um teto de ${teto} por dia`,
    saiu30: "Saiu em 30 dias, com os fixos",
    saiu30Detalhe: (varia: string, fixos: string) => `${varia} do que varia e ${fixos} de fixos`,
    entrou30: "Entrou em 30 dias",
    semCobranca: "Ainda sem cobrança. As assinaturas entram aqui quando a cobrança existir; até lá, o resultado é só o que saiu.",
    resultado30: "Resultado em 30 dias",
    menos: (valor: string) => `menos ${valor}`,
    cambio: (cambio: string, data: string) => `Em reais, com o dólar a R$ ${cambio} (câmbio de ${data}).`,
  },
  contas: {
    titulo: "As contas",
    verContas: "Ver em Contas",
    ativas: "Ativas",
    usaramOntem: "Usaram ontem",
    pararam: "Pararam de gravar",
    briefingIncompleto: "Briefing incompleto",
    novas: "Novas na semana",
  },
  produto: {
    titulo: "O produto na semana",
    verGeracoes: "Ver em Gerações",
    escritos: "Roteiros escritos",
    gravados: "Gravados",
    postados: "Postados",
    reprovados: "Reprovados",
    motivo: (motivo: string, vezes: number, total: number) => `O motivo mais comum de reprovar: "${motivo}", ${vezes} de ${total}.`,
    semReprovacao: "Nenhum roteiro reprovado na semana.",
  },
};

function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export const textosContasAdmin = {
  titulo: "Contas",
  subtitulo: (n: number) => (n === 1 ? "1 conta" : `${n} contas`),
  buscar: "Buscar por conta ou pessoa",
  novaConta: "Nova conta",
  filtros: {
    aria: "Filtrar as contas",
    todas: "Todas",
    usando: "Usando",
    parou: "Parou",
    naoEntrou: "Não entrou",
    doQueTodas: "as contas",
    doQueUsando: "gravaram nos últimos 3 dias",
    doQueParou: "nada há 4 dias ou mais",
    doQueNaoEntrou: "ninguém abriu o aplicativo",
  },
  colunas: { conta: "Conta", pessoas: "Pessoas", briefing: "Briefing", ultimos7: "Últimos 7 dias", ultimo: "Último roteiro", instalou: "Instalou", push: "Push", abrir: "Abrir" },
  tipo: { negocio: "Empresa", pessoa: "Pessoal" } as const,
  semRamo: "sem ramo",
  semNota: "sem nota",
  semPessoa: "ninguém com acesso",
  maisPessoas: (n: number) => `+${n}`,
  semRoteiro: "sem roteiro ainda",
  semGravar: (dias: number) => (dias === 0 ? "gravou hoje" : dias === 1 ? "1 dia sem gravar" : `${dias} dias sem gravar`),
  estados: { gravou: "gravou", gerou: "gerou roteiro", entrou: "só entrou", nada: "nada" } satisfies Record<EstadoDoDia, string>,
  legenda: { gravou: "Gravou", gerou: "Gerou roteiro", entrou: "Só entrou", nada: "Nada" },
  semana: (estados: string[]) => `Últimos 7 dias, do mais antigo ao de hoje: ${estados.join(", ")}`,
  vazio: "Nenhuma conta ainda. Crie a primeira para começar.",
  semResultado: "Nenhuma conta nem pessoa com esse nome.",
  semNoFiltro: "Nenhuma conta neste filtro.",
  abrir: "Abrir",
  instalouNao: "não",
  sistemaDaInstalacao: { iphone: "iPhone", android: "Android", computador: "computador" } as const,
  aparelhos: (n: number) => (n === 0 ? "nenhum" : n === 1 ? "1 aparelho" : `${n} aparelhos`),
  achadosPessoa: (conta: number) => `Esta pessoa tem acesso a ${conta} contas`,
};

export const textosContaAdmin = {
  voltar: "Contas",
  blocos: {
    identidade: "Identidade",
    acesso: "Quem tem acesso",
    briefing: "Briefing",
    uso: "Uso",
    ajustes: "Ajustes",
  },
  identidade: {
    nome: "Nome",
    tipo: "Tipo",
    ramo: "Ramo",
    rede: "Rede principal",
    publico: "Público",
    trocar: "Trocar",
    semRamo: "sem ramo",
    semRede: "ainda não escolheu",
    semPublico: "não informado",
    tipoNegocio: "Empresa",
    tipoPessoa: "Pessoal",
  },
  briefing: {
    estadoCompleto: "completo",
    estadoIncompleto: "incompleto",
    semBriefing: "ainda não começou",
    nota: (n: string) => `nota ${n}`,
  },
  uso: {
    roteiros: "Roteiros",
    ultimo: "Último roteiro",
    semGravar: "Dias sem gravar",
    reprovou: "O que já reprovou",
    diaADia: "Dia a dia",
    diaADiaLegenda: "o que a conta fez nos últimos 14 dias",
    colunas: { dia: "Dia", escritos: "Escritos", gravados: "Gravados", postados: "Postados" },
    entradas: "Última vez que cada pessoa entrou",
    nuncaEntrou: "ainda não entrou",
  },
  ajustes: {
    roteirosPorDia: "Roteiros por dia",
    umPorDia: "um por dia",
    semLimite: "sem limite",
    tetoDoMes: "Teto de custo do mês",
    tetoDoMesTexto: (usd: string, reaisTexto: string) => `${usd} (${reaisTexto}), igual para todas as contas`,
    tetoNota: "Hoje o teto é o mesmo para todas as contas; trocar por conta vem depois.",
  },
  trocar: {
    ramoTitulo: (nome: string) => `Trocar o ramo de ${nome}`,
    ramoAviso: "Ao trocar, a base de vídeos e os temas passam a ser os do ramo novo, a partir da próxima madrugada. O briefing e os roteiros continuam.",
    ramoBotao: (ramo: string) => `Trocar para ${ramo}`,
    cancelar: "Cancelar",
    salvando: "Salvando",
    tipoTitulo: (nome: string) => `Trocar o tipo de ${nome}`,
    tipoAviso: "Ao trocar o tipo, as perguntas do briefing mudam: o briefing que existe hoje, o perfil que ele gerou e o que a pessoa confirmou sobre a marca são apagados, e quem usa a conta responde de novo. Os roteiros continuam.",
    tipoBotao: (tipo: string) => `Trocar para ${tipo}`,
    redeTitulo: (nome: string) => `Rede principal de ${nome}`,
    redeBotao: (rede: string) => `Usar ${rede}`,
    publicoTitulo: (nome: string) => `Público de ${nome}`,
    publicoErro: "Não deu para salvar. O público continua o de antes.",
    publicoBrasil: "Brasil todo",
    publicoLocal: "Uma cidade ou região",
    publicoOutroPais: "Outro país",
    publicoMaisPaises: "Mais de um país",
    campoRegiao: "Cidade ou região",
    campoPais: "País",
    campoPaises: "Quais países",
    salvar: "Salvar",
    erroRede: "Não deu para trocar a rede. Ela continua a de antes.",
    erroRamo: "Não deu para trocar o ramo. Ele continua o de antes.",
    erroTipo: "Não deu para trocar o tipo. Ele continua o de antes.",
    erroLimite: "Não deu para salvar o limite. Ele continua o de antes.",
    erroNome: "Não deu para salvar o nome. Ele continua o de antes.",
    publicoErroGenerico: "Não deu para salvar. O público continua o de antes.",
  },
  registro: {
    titulo: "O que o admin trocou aqui",
    vazio: "Nenhuma troca registrada nesta conta.",
    campo: { ramo: "Ramo", tipo: "Tipo", rede_principal: "Rede principal", publico: "Público", roteiros_por_dia: "Roteiros por dia" } as Record<string, string>,
    frase: (campo: string, antes: string | null, depois: string | null) => `${campo}: de ${antes ?? "nada"} para ${depois ?? "nada"}`,
    quem: (nome: string | null) => nome ?? "alguém da equipe",
  },
};
