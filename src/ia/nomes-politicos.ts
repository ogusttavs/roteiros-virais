/**
 * E59: o roteiro nunca escreve nome de partido nem de candidato (decisão do Gustavo em 22/10/2026, `R-CONF-10` da seção 11 das rubricas).
 * Função pura, sem I/O.
 *
 * Partido: a lista oficial do TSE (`config/partidos-tse.ts`, fonte em `pesquisa/partidos/`). Nome e sigla têm graus de risco de falso alarme,
 * e `R-CONF` reprova nas duas tentativas, então um falso alarme derruba a geração de uma pessoa que não falou de política:
 *   1. Sempre: o nome completo que começa por "Partido ..." (e os que só existem como partido: "Movimento Democrático Brasileiro", "União Brasil",
 *      as federações) e as siglas que ninguém usa para outra coisa (PSDB, PSOL, MDB, PDT, PSTU, PRTB, PCdoB). Siglas só em MAIÚSCULAS.
 *   2. Com contexto político no texto (partido, eleição, candidato, deputado, voto...): as siglas curtas que têm outro uso (PT é também "personal trainer",
 *      PSD é arquivo do Photoshop, PCB é placa de circuito, PL é também "projeto de lei" com número).
 *   3. Só logo depois de "partido" ou "legenda": as palavras comuns que também são nome de partido (Novo, Podemos, Cidadania, Avante, Agir, Democrata,
 *      Solidariedade, Republicanos, Progressistas...) e as siglas PP, PV, DC e UP (polipropileno, painel fotovoltaico...).
 * Candidato não dá para listar (são milhares e mudam a cada eleição): pega o padrão "cargo mais nome próprio" ("deputado Fulano de Tal",
 * "candidata Maria Souza"). O resto é a regra do prompt.
 */
import { FEDERACOES_TSE, PARTIDOS_TSE } from "@/config/partidos-tse";

export type AchadoPolitico = { tipo: "partido" | "candidato"; trecho: string };

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .join(" ")
    .trim();
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NOMES_DE_PARTIDO = PARTIDOS_TSE.map((p) => normalizar(p.nome));

/** Nomes que só existem como partido: o começo "partido ..." e os nomes próprios longos. */
const NOMES_SEGUROS = new Set<string>([
  ...NOMES_DE_PARTIDO.filter((n) => n.startsWith("partido ")),
  "movimento democratico brasileiro",
  "uniao brasil",
  "democracia crista",
  "rede sustentabilidade",
  ...FEDERACOES_TSE.map((f) => normalizar(f).replace(/ - fe brasil$/, "")),
]);

/** Palavras e frases comuns que também são nome de partido: só depois de "partido" ou "legenda". */
const NOMES_COMUNS = [
  ...new Set([...NOMES_DE_PARTIDO.filter((n) => !NOMES_SEGUROS.has(n)), ...PARTIDOS_TSE.map((p) => normalizar(p.sigla)), "progressistas"]),
];

const SIGLAS_SEMPRE = ["PSDB", "PSOL", "MDB", "PDT", "PSTU", "PRTB", "PCdoB", "PCDOB", "PC do B"];
const SIGLAS_COM_CONTEXTO = ["PT", "PL", "PSD", "PSB", "PCB", "PRD", "PCO"];

const CONTEXTO_POLITICO =
  /(^|[^a-z])(partidos?|legenda|eleic(ao|oes|toral|toras)|eleitor(es|ado)?|candidat[oa]s?|deputad[oa]s?|senador(a|es)?|vereador(a|es)?|prefeit[oa]s?|governador(a|es)?|presidenciave(l|is)|voto|votos|votar|votou|urna|politic[oa]s?|congresso|bancada|coligacao)([^a-z]|$)/;

const MARCADOR = "(?:partidos?|legenda|sigla|filiad[oa]s? (?:ao|a|aos|as)|do partido)";

function marcadorMaisNome(): RegExp {
  const nomes = NOMES_COMUNS.map(escapar).join("|");
  return new RegExp(`(?:^|[^a-z])${MARCADOR} (?:d[oa]s? )?(${nomes})(?![a-z])`);
}

function nomeSeguro(): RegExp {
  const nomes = [...NOMES_SEGUROS].map(escapar).join("|");
  return new RegExp(`(?:^|[^a-z])(${nomes})(?![a-z])`);
}

const RE_MARCADOR = marcadorMaisNome();
const RE_SEGURO = nomeSeguro();

function reSigla(siglas: string[]): RegExp {
  const lista = siglas.map(escapar).join("|");
  // Sigla em maiúsculas, sozinha; "PL 2630" é projeto de lei, não o partido.
  return new RegExp(`(?<![A-Za-zÀ-ÿ0-9])(${lista})(?![A-Za-zÀ-ÿ0-9]|[ ]?-[ ]?BR|[ ]?[0-9]{3,})`);
}

const RE_SIGLA_SEMPRE = reSigla(SIGLAS_SEMPRE);
const RE_SIGLA_COM_CONTEXTO = reSigla(SIGLAS_COM_CONTEXTO);

const CARGOS = "(?:[Cc]andidat[oa]|[Dd]eputad[oa]|[Ss]enador(?:a)?|[Vv]ereador(?:a)?|[Gg]overnador(?:a)?|[Pp]refeit[oa]|[Pp]residente)";
const QUALIFICADOR = "(?:[Ff]ederal|[Ee]stadual|[Dd]istrital|[Mm]unicipal|[Ee]leit[oa]|[Rr]eeleit[oa])";
const NOME = "\\p{Lu}[\\p{L}'’-]{2,}";
const RE_CARGO_NOME = new RegExp(`(?<![\\p{L}])(${CARGOS})((?:[ ]+${QUALIFICADOR})*)[ ]+(${NOME}(?:[ ]+${NOME}){0,2})`, "gu");

/** Palavras com inicial maiúscula que seguem um cargo sem ser nome de gente (começo de frase, lugar, qualificador). */
const NAO_E_NOME = new Set(
  [
    "federal", "estadual", "distrital", "municipal", "eleito", "eleita", "reeleito", "reeleita", "brasil", "estado", "estados", "mais", "votado", "votada",
    "que", "quando", "como", "porque", "pois", "mas", "para", "por", "com", "sem", "hoje", "ontem", "aqui", "ali", "esse", "essa", "este", "esta", "isso",
    "isto", "uma", "uns", "umas", "ele", "ela", "eles", "elas", "nao", "sim", "ainda", "tambem", "entao", "depois", "antes", "quem", "qual", "quais",
    "republica", "camara", "senado", "assembleia", "congresso", "nacional", "geral", "titular", "candidato", "candidata", "deputado", "deputada",
    "senador", "senadora", "prefeito", "prefeita", "governador", "governadora", "vereador", "vereadora", "presidente",
  ].map(normalizar),
);

function achaCandidato(texto: string): string | null {
  const contexto = CONTEXTO_POLITICO.test(normalizar(texto));
  for (const m of texto.matchAll(RE_CARGO_NOME)) {
    const cargo = m[1];
    const tokens = m[3].split(/[ ]+/);
    // Tira do começo o que não é nome; o que sobra tem de ter pelo menos um nome de verdade.
    while (tokens.length > 0 && NAO_E_NOME.has(normalizar(tokens[0]))) tokens.shift();
    if (tokens.length === 0) continue;
    // "presidente" também é cargo de empresa e de associação: só vale com contexto político no texto.
    if (/^[Pp]residente$/.test(cargo) && !contexto) continue;
    return `${cargo.toLowerCase()} ${tokens.join(" ")}`;
  }
  return null;
}

/** O primeiro nome de partido ou de candidato do texto, ou nulo. */
export function acharNomePolitico(texto: string): AchadoPolitico | null {
  const linha = texto.split(String.fromCharCode(10)).join(" ").split(String.fromCharCode(13)).join(" ");
  const normal = normalizar(linha);

  const seguro = RE_SEGURO.exec(normal);
  if (seguro) return { tipo: "partido", trecho: seguro[1] };
  const sigla = RE_SIGLA_SEMPRE.exec(linha);
  if (sigla) return { tipo: "partido", trecho: sigla[1] };
  if (CONTEXTO_POLITICO.test(normal)) {
    const comContexto = RE_SIGLA_COM_CONTEXTO.exec(linha);
    if (comContexto) return { tipo: "partido", trecho: comContexto[1] };
  }
  const comum = RE_MARCADOR.exec(normal);
  if (comum) return { tipo: "partido", trecho: comum[1] };

  const candidato = achaCandidato(linha);
  if (candidato) return { tipo: "candidato", trecho: candidato };
  return null;
}
