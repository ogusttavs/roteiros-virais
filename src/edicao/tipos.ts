/**
 * Tipos do motor de corte e legenda (E47, PR 1). Tudo aqui é dado puro: o motor não lê arquivo,
 * não chama rede nem IA. Os tempos são sempre em segundos.
 */

/** Uma palavra falada, com o tempo que o transcritor (Groq, no produto) deu a ela. */
export type PalavraFalada = {
  texto: string;
  inicio: number;
  fim: number;
  /** O transcritor abriu um trecho novo (frase nova) nesta palavra. Serve para a maiúscula da legenda. */
  abreTrecho?: boolean;
};

/** Mapa de energia do áudio: dB RMS em janelas de 10 ms, da primeira à última. */
export type Energia = {
  db: Float32Array;
  /** Duração real do áudio em segundos (não é db.length / 100: sobra menos de uma janela). */
  duracao: number;
};

export type PresetRitmo = "vlog" | "aula" | "reels";

export type Ritmo = {
  /** Vão entre duas palavras acima disto vira pausa a encurtar. */
  pausaMaxima: number;
  /** Quanto da pausa fica depois de encurtada (60% depois da fala, 40% antes da próxima). */
  pausaQueFica: number;
  /** Folga antes da primeira palavra da primeira seleção. */
  folgaInicio: number;
  /** Folga depois da última palavra do vídeo. */
  folgaFim: number;
};

export type TransicaoCorte = "combinar" | "direita" | "desfocar";

/** Um intervalo que a decisão editorial marcou, em tempo do vídeo bruto. */
export type IntervaloEditorial = {
  de: number;
  ate: number;
  motivo?: string;
  /** Troca de assunto: a transição entra neste ponto. */
  transicao?: TransicaoCorte;
};

export type ConfigCorte = {
  preset?: PresetRitmo;
  /** Ajuste fino por cima do preset. */
  ritmo?: Partial<Ritmo>;
  /** Trechos a tirar (retake, falso início, enrolação). */
  remocoes?: IntervaloEditorial[];
  /** Versão curta: se houver, só ficam os trechos listados. */
  selecoes?: IntervaloEditorial[];
  /** Zoom alternado nos cortes de quem fala para a câmera (0 desliga; 0.08 = 8%). */
  zoomEmCortes?: number;
  /** Segundos de último quadro parado no fim. Se faltar, o motor decide pelo respiro natural da gravação. */
  respiroFinal?: number;
};

export type Trecho = {
  /** Intervalo mantido, em tempo do vídeo bruto. */
  origem: [number, number];
  /** O que veio depois deste trecho no bruto: "pausa", "removido", "fim" (ou combinações) ou null no último. */
  corteDepois: string | null;
  transicaoEntrada?: TransicaoCorte;
  /** Onde o trecho cai na linha do tempo cortada. */
  destino: [number, number];
  /** 1 sem zoom; 1 + zoomEmCortes nos trechos alternados. */
  escala: number;
};

/** Lista de decisão de edição: o que o render (ffmpeg) vai montar. */
export type Edl = {
  limiarSilencioDb: number;
  /** Duração do vídeo cortado, sem o respiro final. */
  duracao: number;
  respiroFinal: number;
  duracaoOrigem: number;
  trechos: Trecho[];
  /** Avisos de corte com palavra ainda soando. Vazio é o esperado. */
  alertas: string[];
  /** Índices (em `palavras`) das palavras que sobraram. A legenda só mostra estas. */
  palavrasMantidas: number[];
};

export type OpcoesLegenda = {
  /** "nativo": blocos curtos, caixa alta. "destaque": blocos de uma linha maiores, caixa normal. */
  estilo?: "nativo" | "destaque";
  maxCaracteres?: number;
  maxPalavras?: number;
  caixaAlta?: boolean;
};

export type BlocoLegenda = { inicio: number; fim: number; texto: string };

export type Legendas = {
  blocos: BlocoLegenda[];
  /** Mesmos blocos em SubRip, pronto para gravar em arquivo. */
  srt: string;
  /** Números, marcas e nomes próprios que o render pode pintar de destaque. */
  palavrasChave: string[];
};

export class ErroEdicao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroEdicao";
  }
}
