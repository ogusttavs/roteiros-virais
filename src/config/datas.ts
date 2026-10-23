/**
 * O calendário de datas (E60, 23/10/2026): feriados, datas que vendem para pequeno negócio e os dias ligados a um ramo do catálogo.
 *
 * A base é curta de propósito (nunca as centenas de "dias de" que não valem nada) e cada data diz de onde vem. Regra de evidência do projeto
 * (`pesquisa/plataformas/GUIA.md`): a data só entra aqui se está nos documentos baixados em `pesquisa/datas/docs/` (leis no Planalto, a portaria do
 * calendário de 2026, a página do conselho da profissão, o Senado, a ONU); `pesquisa/datas/fontes.txt` tem a URL e `baixar.py` refaz o download.
 * O campo `arquivo` de cada data é o nome do arquivo lá, para quem revisa achar a fonte em um passo.
 *
 * Nada aqui toca em banco nem em relógio: as funções recebem a data (`AAAA-MM-DD`, o dia do Brasil) e devolvem datas. Os móveis (Carnaval, Sexta-feira Santa,
 * Páscoa, Corpus Christi) vêm do cálculo da Páscoa, que tem teste para anos conhecidos; os que dependem de dia da semana (Dia das Mães, Dia dos Pais, Black Friday)
 * vêm de uma regra "enésimo dia da semana do mês".
 *
 * Quem a marca é: `ramos` de cada data é "geral" (aparece para todas as marcas) ou a lista de ramos do catálogo (`src/config/ramos.ts`) a que a data interessa.
 * A marca vê as gerais mais as do ramo principal e dos ramos alternativos dela.
 */

export type TipoDeData = "feriado" | "ponto-facultativo" | "comercial" | "do-ramo";

type Regra =
  /** Dia fixo do ano. */
  | { tipo: "fixa"; mes: number; dia: number }
  /** O `n`-ésimo `diaDaSemana` (0 domingo a 6 sábado) do mês, mais `somarDias` (Black Friday é a quinta de Ação de Graças, a 4ª de novembro, mais um dia). */
  | { tipo: "enesimo"; mes: number; n: number; diaDaSemana: number; somarDias?: number }
  /** Dias antes (negativo) ou depois da Páscoa; vários dias valem a mesma data (o Carnaval são a segunda e a terça). */
  | { tipo: "pascoa"; dias: readonly number[] };

export type DataDoCalendario = {
  /** A identidade estável da data (nunca muda; o nome pode ser reescrito). */
  chave: string;
  /** Como a pessoa lê, sem artigo: cabe em "Hoje é ..." e em "Daqui a 7 dias é ...". */
  nome: string;
  tipo: TipoDeData;
  /** "geral" para todas as marcas, ou os slugs de ramo (`src/config/ramos.ts`) a que a data interessa. */
  ramos: "geral" | readonly string[];
  regra: Regra;
  /** De onde vem, em uma frase curta (a lei, o conselho, a instituição). */
  fonte: string;
  /** O arquivo de `pesquisa/datas/docs/` (sem a extensão `.md`) que prova a data, ou "calculo" para as datas móveis. */
  arquivo: string;
};

const DOM = 0;
const QUI = 4;

const fixa = (mes: number, dia: number): Regra => ({ tipo: "fixa", mes, dia });

export const DATAS_DO_CALENDARIO: readonly DataDoCalendario[] = [
  // Feriados nacionais: Lei 662/1949 com a redação da Lei 10.607/2002, Lei 6.802/1980 (Aparecida), Lei 14.759/2023 (20 de novembro) e a Portaria MGI 11.460/2025 (a Paixão de Cristo).
  { chave: "confraternizacao-universal", nome: "Confraternização Universal", tipo: "feriado", ramos: "geral", regra: fixa(1, 1), fonte: "Lei 662/1949", arquivo: "lei-662-1949-feriados" },
  { chave: "sexta-feira-santa", nome: "Sexta-feira Santa", tipo: "feriado", ramos: "geral", regra: { tipo: "pascoa", dias: [-2] }, fonte: "Portaria MGI 11.460/2025 (Paixão de Cristo)", arquivo: "portaria-mgi-11460-2025-copia-do-dou" },
  { chave: "tiradentes", nome: "Tiradentes", tipo: "feriado", ramos: "geral", regra: fixa(4, 21), fonte: "Lei 10.607/2002", arquivo: "lei-10607-2002-feriados" },
  { chave: "dia-do-trabalho", nome: "Dia do Trabalho", tipo: "feriado", ramos: "geral", regra: fixa(5, 1), fonte: "Lei 662/1949", arquivo: "lei-662-1949-feriados" },
  { chave: "independencia", nome: "Independência do Brasil", tipo: "feriado", ramos: "geral", regra: fixa(9, 7), fonte: "Lei 662/1949", arquivo: "lei-662-1949-feriados" },
  { chave: "nossa-senhora-aparecida", nome: "Nossa Senhora Aparecida", tipo: "feriado", ramos: "geral", regra: fixa(10, 12), fonte: "Lei 6.802/1980", arquivo: "lei-6802-1980-aparecida" },
  { chave: "finados", nome: "Finados", tipo: "feriado", ramos: "geral", regra: fixa(11, 2), fonte: "Lei 10.607/2002", arquivo: "lei-10607-2002-feriados" },
  { chave: "proclamacao-da-republica", nome: "Proclamação da República", tipo: "feriado", ramos: "geral", regra: fixa(11, 15), fonte: "Lei 662/1949", arquivo: "lei-662-1949-feriados" },
  { chave: "consciencia-negra", nome: "Dia da Consciência Negra", tipo: "feriado", ramos: "geral", regra: fixa(11, 20), fonte: "Lei 14.759/2023", arquivo: "lei-14759-2023-consciencia-negra" },
  { chave: "natal", nome: "Natal", tipo: "feriado", ramos: "geral", regra: fixa(12, 25), fonte: "Lei 662/1949", arquivo: "lei-662-1949-feriados" },

  // Pontos facultativos do governo federal (a lei não os declara feriado; muita cidade os trata como feriado por lei local, Lei 9.093/1995).
  { chave: "carnaval", nome: "Carnaval", tipo: "ponto-facultativo", ramos: "geral", regra: { tipo: "pascoa", dias: [-48, -47] }, fonte: "Portaria MGI 11.460/2025 (ponto facultativo)", arquivo: "portaria-mgi-11460-2025-copia-do-dou" },
  { chave: "corpus-christi", nome: "Corpus Christi", tipo: "ponto-facultativo", ramos: "geral", regra: { tipo: "pascoa", dias: [60] }, fonte: "Portaria MGI 11.460/2025 (ponto facultativo)", arquivo: "portaria-mgi-11460-2025-copia-do-dou" },

  // Datas que vendem para qualquer pequeno negócio.
  { chave: "pascoa", nome: "Páscoa", tipo: "comercial", ramos: "geral", regra: { tipo: "pascoa", dias: [0] }, fonte: "Cálculo da Páscoa (calendário gregoriano)", arquivo: "calculo" },
  { chave: "dia-das-maes", nome: "Dia das Mães", tipo: "comercial", ramos: "geral", regra: { tipo: "enesimo", mes: 5, n: 2, diaDaSemana: DOM }, fonte: "Decreto 21.366/1932 (segundo domingo de maio)", arquivo: "decreto-21366-1932-dia-das-maes" },
  { chave: "dia-dos-namorados", nome: "Dia dos Namorados", tipo: "comercial", ramos: "geral", regra: fixa(6, 12), fonte: "Agência Brasil (data de campanha do comércio, desde 1948)", arquivo: "agencia-brasil-dia-dos-namorados" },
  { chave: "dia-dos-pais", nome: "Dia dos Pais", tipo: "comercial", ramos: "geral", regra: { tipo: "enesimo", mes: 8, n: 2, diaDaSemana: DOM }, fonte: "Agência Brasil (segundo domingo de agosto)", arquivo: "agencia-brasil-dia-dos-pais" },
  { chave: "dia-do-consumidor", nome: "Dia do Consumidor", tipo: "comercial", ramos: "geral", regra: fixa(3, 15), fonte: "Câmara dos Deputados (15 de março, data da ONU)", arquivo: "camara-dia-do-consumidor-15-marco" },
  { chave: "dia-do-cliente", nome: "Dia do Cliente", tipo: "comercial", ramos: "geral", regra: fixa(9, 15), fonte: "Rádio Senado (data do comércio, desde 2003)", arquivo: "radio-senado-dia-do-cliente" },
  { chave: "dia-da-micro-e-pequena-empresa", nome: "Dia da Micro e Pequena Empresa", tipo: "comercial", ramos: "geral", regra: fixa(10, 5), fonte: "Senado (aniversário do estatuto da micro e pequena empresa)", arquivo: "senado-dia-da-micro-e-pequena-empresa" },
  { chave: "dia-das-criancas", nome: "Dia das Crianças", tipo: "comercial", ramos: "geral", regra: fixa(10, 12), fonte: "Decreto 4.867/1924, pelo Senado", arquivo: "senado-dia-da-crianca-12-outubro" },
  { chave: "black-friday", nome: "Black Friday", tipo: "comercial", ramos: "geral", regra: { tipo: "enesimo", mes: 11, n: 4, diaDaSemana: QUI, somarDias: 1 }, fonte: "Procon-SP (a sexta-feira depois do Dia de Ação de Graças)", arquivo: "procon-sp-black-friday" },
  {
    chave: "dia-da-mulher",
    nome: "Dia Internacional da Mulher",
    tipo: "comercial",
    ramos: ["cabelo-e-barbearia", "estetica-e-pele", "unhas-cilios-e-sobrancelha", "maquiagem-e-cosmeticos", "moda-e-vestuario", "joias-oculos-e-acessorios"],
    regra: fixa(3, 8),
    fonte: "ONU (8 de março)",
    arquivo: "onu-brasil-8-de-marco",
  },

  // Dias ligados a um ramo do catálogo.
  { chave: "dia-do-cirurgiao-dentista", nome: "Dia do Cirurgião-Dentista", tipo: "do-ramo", ramos: ["odontologia"], regra: fixa(10, 25), fonte: "Conselho Federal de Odontologia", arquivo: "cfo-dia-do-cirurgiao-dentista" },
  { chave: "dia-do-medico", nome: "Dia do Médico", tipo: "do-ramo", ramos: ["medicina-e-clinicas"], regra: fixa(10, 18), fonte: "Conselho Federal de Medicina", arquivo: "cfm-dia-do-medico" },
  { chave: "dia-do-nutricionista", nome: "Dia do Nutricionista", tipo: "do-ramo", ramos: ["nutricao"], regra: fixa(8, 31), fonte: "Conselho Federal de Nutricionistas", arquivo: "cfn-dia-do-nutricionista" },
  { chave: "dia-do-psicologo", nome: "Dia do Psicólogo", tipo: "do-ramo", ramos: ["psicologia-e-terapias"], regra: fixa(8, 27), fonte: "Lei 4.119/1962 (a que regulamentou a profissão)", arquivo: "lei-4119-1962-psicologo" },
  { chave: "dia-do-fisioterapeuta", nome: "Dia do Fisioterapeuta", tipo: "do-ramo", ramos: ["fisioterapia-e-pilates"], regra: fixa(10, 13), fonte: "Decreto-Lei 938/1969 (o que regulamentou a profissão)", arquivo: "decreto-lei-938-1969-fisioterapeuta" },
  { chave: "dia-do-medico-veterinario", nome: "Dia do Médico-Veterinário", tipo: "do-ramo", ramos: ["veterinaria-e-pet"], regra: fixa(9, 9), fonte: "Conselho Federal de Medicina Veterinária", arquivo: "cfmv-historia-dia-do-veterinario" },
  { chave: "dia-mundial-dos-animais", nome: "Dia Mundial dos Animais", tipo: "do-ramo", ramos: ["veterinaria-e-pet"], regra: fixa(10, 4), fonte: "Conselho Regional de Medicina Veterinária de São Paulo", arquivo: "crmv-sp-dia-mundial-dos-animais" },
  { chave: "dia-do-profissional-de-educacao-fisica", nome: "Dia do Profissional de Educação Física", tipo: "do-ramo", ramos: ["academia-e-treino", "esportes-e-lutas"], regra: fixa(9, 1), fonte: "Lei 9.696/1998 (a que regulamentou a profissão)", arquivo: "lei-9696-1998-educacao-fisica" },
  { chave: "dia-do-professor", nome: "Dia do Professor", tipo: "do-ramo", ramos: ["educacao-e-cursos"], regra: fixa(10, 15), fonte: "Decreto 52.682/1963", arquivo: "decreto-52682-1963-dia-do-professor" },
  { chave: "dia-da-advocacia", nome: "Dia da Advocacia", tipo: "do-ramo", ramos: ["advocacia"], regra: fixa(8, 11), fonte: "Ordem dos Advogados do Brasil", arquivo: "oab-dia-da-advocacia" },
  { chave: "dia-do-profissional-da-contabilidade", nome: "Dia do Profissional da Contabilidade", tipo: "do-ramo", ramos: ["contabilidade-e-financas"], regra: fixa(4, 25), fonte: "Conselho Federal de Contabilidade", arquivo: "cfc-dia-do-profissional-da-contabilidade" },
  { chave: "dia-do-corretor-de-imoveis", nome: "Dia do Corretor de Imóveis", tipo: "do-ramo", ramos: ["imoveis"], regra: fixa(8, 27), fonte: "Conselho Regional de Corretores de Imóveis", arquivo: "creci-dia-do-corretor-de-imoveis" },
  { chave: "dia-da-arvore", nome: "Dia da Árvore", tipo: "do-ramo", ramos: ["jardim-e-paisagismo", "agro-e-campo"], regra: fixa(9, 21), fonte: "Decreto 55.795/1965", arquivo: "decreto-55795-1965-dia-da-arvore" },
  {
    chave: "dia-mundial-da-alimentacao",
    nome: "Dia Mundial da Alimentação",
    tipo: "do-ramo",
    ramos: ["restaurante-e-lanchonete", "confeitaria-e-padaria", "bar-cafe-e-bebidas", "alimentos-e-mercado"],
    regra: fixa(10, 16),
    fonte: "ONU e FAO (aniversário da FAO)",
    arquivo: "fao-dia-mundial-da-alimentacao",
  },
  { chave: "dia-da-lavagem-das-maos", nome: "Dia Mundial da Lavagem das Mãos", tipo: "do-ramo", ramos: ["limpeza-e-organizacao-da-casa"], regra: fixa(10, 15), fonte: "Organização Mundial da Saúde", arquivo: "oms-dia-mundial-da-lavagem-das-maos" },
  { chave: "dia-internacional-da-ioga", nome: "Dia Internacional da Ioga", tipo: "do-ramo", ramos: ["danca-e-ioga"], regra: fixa(6, 21), fonte: "ONU (resolução de 2014)", arquivo: "onu-dia-internacional-da-ioga" },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Datas de calendário puro (AAAA-MM-DD, sempre em UTC ao meio-dia): nada aqui depende do fuso do servidor.

function paraISO(ano: number, mes: number, dia: number): string {
  return new Date(Date.UTC(ano, mes - 1, dia, 12)).toISOString().slice(0, 10);
}

function partes(dataISO: string): [number, number, number] {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return [ano, mes, dia];
}

/** Soma (ou subtrai) dias a uma data `AAAA-MM-DD`. */
export function somarDias(dataISO: string, dias: number): string {
  const [ano, mes, dia] = partes(dataISO);
  return paraISO(ano, mes, dia + dias);
}

/** Quantos dias de `de` até `ate` (positivo quando `ate` é depois). */
export function diasEntreDatas(de: string, ate: string): number {
  const [a1, m1, d1] = partes(de);
  const [a2, m2, d2] = partes(ate);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/**
 * O domingo de Páscoa do ano, `AAAA-MM-DD` (algoritmo de Meeus, Jones e Butcher para o calendário gregoriano, o mesmo que o computus da Igreja usa
 * desde 1583). Dele saem o Carnaval (47 e 48 dias antes), a Sexta-feira Santa (2 antes) e o Corpus Christi (60 depois).
 */
export function pascoaDoAno(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return paraISO(ano, mes, dia);
}

/** O `n`-ésimo `diaDaSemana` (0 domingo a 6 sábado) do mês, `AAAA-MM-DD`. */
export function enesimoDiaDaSemana(ano: number, mes: number, n: number, diaDaSemana: number): string {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1, 12)).getUTCDay();
  const deslocamento = (diaDaSemana - primeiro + 7) % 7;
  return paraISO(ano, mes, 1 + deslocamento + (n - 1) * 7);
}

/** As datas (uma ou mais) em que a data cai no ano. */
export function ocorrenciasNoAno(data: DataDoCalendario, ano: number): string[] {
  const regra = data.regra;
  if (regra.tipo === "fixa") return [paraISO(ano, regra.mes, regra.dia)];
  if (regra.tipo === "enesimo") return [somarDias(enesimoDiaDaSemana(ano, regra.mes, regra.n, regra.diaDaSemana), regra.somarDias ?? 0)];
  const pascoa = pascoaDoAno(ano);
  return regra.dias.map((dias) => somarDias(pascoa, dias));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** Uma data marcada num dia do calendário: o que a tela precisa, sem nada que não atravesse do servidor para o navegador. */
export type DataMarcada = { chave: string; nome: string; tipo: TipoDeData; data: string; fonte: string };

export type DataProxima = DataMarcada & { dias: number };

/** A data vale para esta marca: as gerais e as que citam um dos ramos dela. */
export function valeParaAMarca(data: DataDoCalendario, ramosDaMarca: readonly string[]): boolean {
  if (data.ramos === "geral") return true;
  return data.ramos.some((ramo) => ramosDaMarca.includes(ramo));
}

/** O que mais interessa à marca vem na frente num mesmo dia: a do ramo dela, depois a que vende, depois o feriado. */
const PRIORIDADE_DO_TIPO: Record<TipoDeData, number> = { "do-ramo": 0, comercial: 1, feriado: 2, "ponto-facultativo": 3 };

/**
 * As datas do período (de `inicio` a `fim`, os dois dentro), só as que valem para a marca, na ordem do calendário e, no mesmo dia, pela prioridade do tipo.
 * O período pode cruzar o ano (uma Semana de 28 de dezembro a 3 de janeiro).
 */
export function datasDoPeriodo(inicio: string, fim: string, ramosDaMarca: readonly string[]): DataMarcada[] {
  const [anoInicio] = partes(inicio);
  const [anoFim] = partes(fim);
  const achadas: DataMarcada[] = [];
  for (let ano = anoInicio; ano <= anoFim; ano += 1) {
    for (const data of DATAS_DO_CALENDARIO) {
      if (!valeParaAMarca(data, ramosDaMarca)) continue;
      for (const dia of ocorrenciasNoAno(data, ano)) {
        if (dia >= inicio && dia <= fim) achadas.push({ chave: data.chave, nome: data.nome, tipo: data.tipo, data: dia, fonte: data.fonte });
      }
    }
  }
  return achadas.sort((a, b) => a.data.localeCompare(b.data) || PRIORIDADE_DO_TIPO[a.tipo] - PRIORIDADE_DO_TIPO[b.tipo] || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** As datas do período agrupadas por dia (só os dias que têm alguma). */
export function datasPorDia(inicio: string, fim: string, ramosDaMarca: readonly string[]): Record<string, DataMarcada[]> {
  const porDia: Record<string, DataMarcada[]> = {};
  for (const data of datasDoPeriodo(inicio, fim, ramosDaMarca)) (porDia[data.data] ??= []).push(data);
  return porDia;
}

/** Quantos dias antes a pessoa ainda é avisada de manhã (o aviso por e-mail e por push): 7 dias para se preparar e 2 para gravar. */
export const DIAS_DE_AVISO: readonly number[] = [7, 2];

/** Até quantos dias antes uma data aparece como sugestão de tema e no Hoje. */
export const JANELA_DA_SUGESTAO_EM_DIAS = 7;

/** O que o Hoje mostra: as datas de hoje e as que chegam nos próximos `janela` dias (da mais perto para a mais longe). */
export function datasDeHojeEProximas(hoje: string, ramosDaMarca: readonly string[], janela = JANELA_DA_SUGESTAO_EM_DIAS): { hoje: DataMarcada[]; proximas: DataProxima[] } {
  const doPeriodo = datasDoPeriodo(hoje, somarDias(hoje, janela), ramosDaMarca);
  return {
    hoje: doPeriodo.filter((data) => data.data === hoje),
    proximas: doPeriodo.filter((data) => data.data !== hoje).map((data) => ({ ...data, dias: diasEntreDatas(hoje, data.data) })),
  };
}

/** As datas que entram no aviso de manhã de hoje: as que chegam daqui a 7 e a 2 dias. */
export function datasParaOAviso(hoje: string, ramosDaMarca: readonly string[]): DataProxima[] {
  const maisLonge = Math.max(...DIAS_DE_AVISO);
  return datasDeHojeEProximas(hoje, ramosDaMarca, maisLonge).proximas.filter((data) => DIAS_DE_AVISO.includes(data.dias));
}
