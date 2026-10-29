/**
 * E47 PR 2: o que a edição pela IA aceita do vídeo bruto e por quanto tempo guarda cada arquivo. Decisões do Gustavo em 29/10/2026 (valem acima do texto do estudo
 * `estrategia/e47-edicao-pela-ia.md`): sem música no servidor; o vídeo bruto é apagado sozinho em 48 horas e o editado em 7 dias; até 30 edições por mês por conta e vídeo de até 3 minutos.
 * O tamanho de 300 MB e a resolução de até 1080p vêm do mesmo estudo (seções 2.1 e 3.2).
 */
export const LIMITES_DA_EDICAO = {
  /** Tamanho do arquivo bruto, em bytes (a conta que os aparelhos mostram: 300 milhões). Na câmera do iPhone, 1080p dá uns 65 MB por minuto. */
  bytesMax: 300 * 1_000_000,
  megasMax: 300,
  /** Duração do bruto, em segundos. A tolerância cobre o iPhone, que grava 3 minutos como 180,03 s. */
  duracaoMaxS: 180,
  duracaoToleranciaS: 1,
  duracaoMinS: 3,
  /** "1080p" é o lado menor da imagem (1080x1920 em pé, 1920x1080 deitado). Acima disso o vídeo é recusado. */
  ladoMenorMax: 1080,
  /** Teto do lado maior, só para vídeo esticado demais (os aparelhos de hoje gravam até 2400 em 1080p). */
  ladoMaiorMax: 2560,
  /** Edições novas por conta em cada mês de Brasília. Uma que falhou antes de gastar (formato recusado, erro nosso) não conta. */
  edicoesPorMes: 30,
} as const;

/** O bruto some sozinho 48 horas depois que chegou inteiro. */
export const GUARDA_DO_BRUTO_MS = 48 * 60 * 60 * 1000;
/** O editado some sozinho 7 dias depois de pronto. */
export const GUARDA_DO_EDITADO_MS = 7 * 24 * 60 * 60 * 1000;
/** Uma edição que ficou em `subindo` por mais que isto (o celular dormiu, a aba fechou) falha e o arquivo parcial sai. */
export const ENVIO_DA_EDICAO_PARADO_APOS_MS = 45 * 60 * 1000;
/** Uma edição `guardado` que ninguém pegou (a fila perdeu o pedido) é enfileirada de novo depois deste tempo. */
export const TRANSCRICAO_ESQUECIDA_APOS_MS = 10 * 60 * 1000;
/** Uma edição `transcrevendo` por mais que isto (o worker caiu) falha. */
export const TRANSCRICAO_PARADA_APOS_MS = 30 * 60 * 1000;
/** Arquivo parcial (`.parte`) mais velho que isto é lixo de um envio que morreu. */
export const PARTE_VELHA_APOS_MS = 2 * 60 * 60 * 1000;

/** O fuso de Brasília não tem horário de verão desde 2019: o mês da cota começa à meia-noite UTC-3. */
export const DESLOCAMENTO_DE_BRASILIA_H = 3;

/** Quantas vezes o worker pega a mesma edição para transcrever antes de desistir (a fila repete 2 vezes: 3 ao todo). */
export const TENTATIVAS_DA_TRANSCRICAO = 3;

/**
 * E47 PR 3: o que a decisão da edição fixa por código, porque o vídeo do produto é sempre a mesma coisa (a pessoa falando para a câmera, seguindo um roteiro, de 30 s a 3 min). O ritmo é o
 * "reels" do editor do Gustavo (corte curto, pausa de 0,6 s para 0,35 s). A legenda é o estilo "nativo" que ele aprovou em 27/10/2026 (caixa alta, blocos de até 4 palavras e 18 letras).
 * O zoom alternado nos cortes é acabamento do PR 5 e fica desligado (o plano de corte já traz a escala de cada trecho, 1 sem zoom).
 */
export const AJUSTES_DA_EDICAO = {
  preset: "reels",
  zoomEmCortes: 0,
  estiloDaLegenda: "nativo",
  /** Menos que isto das palavras mantido, num vídeo com mais de `palavrasParaConferirOQueFica` palavras, é decisão suspeita (o modelo cortou quase tudo). */
  fracaoMinimaDaFala: 0.25,
  palavrasParaConferirOQueFica: 20,
  /** O título do primeiro quadro: no máximo 2 linhas de 3 a 5 palavras. */
  tituloMaxPalavras: 10,
  tituloMaxLetras: 70,
  subtituloMaxPalavras: 6,
  subtituloMaxLetras: 40,
  /** Quantas decisões do modelo forte por edição: a primeira e, se a conferência reprovar, uma segunda com o motivo. */
  decisoesPorEdicao: 2,
} as const;

/** Quantas vezes o worker pega a mesma edição para decidir antes de desistir (a IA pode estar fora do ar ou sem crédito). */
export const TENTATIVAS_DA_DECISAO = 3;
/** Uma edição `transcrito` ou `decidido` que ninguém pegou (a fila perdeu o pedido, a IA estava fora do ar) é enfileirada de novo depois deste tempo. */
export const DECISAO_ESQUECIDA_APOS_MS = 10 * 60 * 1000;
/** Uma edição `decidindo` por mais que isto (o worker caiu no meio) volta ao passo anterior. */
export const DECISAO_PARADA_APOS_MS = 20 * 60 * 1000;

/**
 * E47 PR 4: o render (a prévia e o vídeo final). Medido em 28/10/2026 na VPS de produção com 1 vCPU: a prévia 540p de 60 s sai em cerca de 43 s e o final 1080p em cerca de 2 minutos. Os
 * tempos máximos abaixo são três vezes isso (o teto da fila: passou, o ffmpeg é morto e a edição conta uma tentativa perdida). Sem música no servidor (decisão do Gustavo em 29/10/2026).
 */
export const AJUSTES_DO_RENDER = {
  /** A prévia: pequena, abre no celular sem pesar (uns 35 MB por minuto no estudo). */
  previa: { largura: 540, altura: 960, crf: 28, audioKbps: 96 },
  /** O final: 1080p em pé, o que o Instagram e o TikTok pedem. */
  final: { largura: 1080, altura: 1920, crf: 23, audioKbps: 128 },
  quadrosPorSegundo: 30,
  /** A transição "combinar" da troca de assunto: 14 quadros a 30 por segundo (a que o Gustavo aprovou). */
  transicaoS: 14 / 30,
  /** Fade curto de cada ponta de áudio em cada corte, para o corte não estalar. */
  fadeDoCorteS: 0.03,
  /** O final: a imagem escurece neste tempo, junto com o texto. */
  fadeFinalS: 0.8,
  /** O título do primeiro quadro fica no mínimo este tempo na tela. */
  tituloS: 3.5,
  /** Quanto o render pode demorar por segundo de vídeo (o teto de tempo): a prévia três vezes o medido na VPS (0,75 s por segundo de vídeo); o final 10 s por segundo, porque o vídeo em HDR do iPhone (HEVC 10 bits com conversão de cor) custou 5,2 s por segundo com 1 vCPU na máquina de desenvolvimento em 29/10/2026. */
  razaoDoLimite: { previa: 0.75 * 3, final: 10 },
  limiteMinimoMs: { previa: 90_000, final: 180_000 },
  limiteMaximoMs: { previa: 10 * 60_000, final: 30 * 60_000 },
} as const;

/** Quantas vezes o worker de render pega a mesma edição antes de desistir (cada tentativa perdida volta para a fila depois de um minuto). */
export const TENTATIVAS_DO_RENDER = 3;
/** Uma edição `verificado` ou `aprovada` que ninguém pegou (a fila perdeu o pedido) é enfileirada de novo depois deste tempo. */
export const RENDER_ESQUECIDO_APOS_MS = 10 * 60 * 1000;
/** Uma edição `montando_previa` ou `montando_final` sem sinal por mais que isto (o contêiner de render caiu) volta para a fila ou, na terceira vez, falha. */
export const RENDER_PARADO_APOS_MS = 40 * 60 * 1000;
/** Quantos pedidos de "Refazer com motivo" uma edição aceita (cada um é outra decisão da IA e outra prévia). */
export const REFAZERES_POR_EDICAO = 3;
/** O motivo do "Refazer" cabe em tantas letras. */
export const MOTIVO_DO_REFAZER_MAX = 300;
/** Quanto tempo a posição na fila conta por vídeo que está na frente (para a frase "cerca de N minutos"), em segundos por vídeo de 1 minuto: prévia e final. */
export const ESTIMATIVA_POR_VIDEO_S = { previa: 60, final: 150 } as const;

/** Tempo máximo do ffmpeg para um render, em milissegundos: três vezes o tempo esperado, com piso e teto. */
export function limiteDoRenderMs(perfil: "previa" | "final", duracaoDoVideoS: number): number {
  const bruto = duracaoDoVideoS * AJUSTES_DO_RENDER.razaoDoLimite[perfil] * 1000;
  return Math.round(Math.min(AJUSTES_DO_RENDER.limiteMaximoMs[perfil], Math.max(AJUSTES_DO_RENDER.limiteMinimoMs[perfil], bruto)));
}
