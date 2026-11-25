/**
 * E65 PR 1: o carrossel, um formato novo ao lado do roteiro. A chave `CARROSSEL_ATIVO` e as constantes do formato moram aqui, num arquivo só do carrossel (nunca em `lib/config.ts`): com a chave
 * desligada (o padrão), nenhuma rota nem tela nova responde, e o resto do aplicativo não muda.
 */

/** A chave lida a cada chamada (não na carga do módulo), para o teste ligar e desligar sem recarregar nada. Só o valor "1" liga. */
export function carrosselAtivo(): boolean {
  return process.env.CARROSSEL_ATIVO === "1";
}

export const TAMANHOS_DO_CARROSSEL = [5, 7, 9] as const;
export type TamanhoDoCarrossel = (typeof TAMANHOS_DO_CARROSSEL)[number];

/** Os tipos que a IA escreve (a lista fechada do schema). O `noticia` não está aqui: a capa de notícia (E66) é montada por código, não escrita no meio de um carrossel. */
export const TIPOS_GERADOS = ["capa-foto", "capa-texto", "passo", "item", "antes-depois", "dado", "prova-fala", "prova-resultado", "resumo", "chamada"] as const;
/** Todos os tipos que o render sabe desenhar: os onze do desenho (E65 PR 2). */
export const TIPOS_DE_SLIDE = [...TIPOS_GERADOS, "noticia"] as const;
export type TipoDeSlide = (typeof TIPOS_DE_SLIDE)[number];

/** Os campos de texto de um slide (as chaves do desenho, `entregaveis/design-v2/entrega/carrossel/README.md`, "Os campos de cada tipo"). */
export type ChaveDeCampo = "rotulo" | "titulo" | "sub" | "texto" | "antes" | "depois" | "valor" | "unidade" | "frase" | "fonte" | "referencia" | "citacao" | "quem" | "contexto" | "veiculo" | "data";
/** Os campos que são listas: as linhas do resumo e as ações da chamada. */
export type ChaveDeLista = "linhas" | "acoes";

/** O limite de um campo: palavras e caracteres (o teto duro), e se ele é obrigatório. */
export type LimiteDeCampo = { palavras: number; caracteres: number; obrigatorio: boolean };
const campo = (palavras: number, caracteres: number, obrigatorio = true): LimiteDeCampo => ({ palavras, caracteres, obrigatorio });

/**
 * Os campos de cada tipo e o limite de cada um (README do desenho, tabela "Os campos de cada tipo"). É a tabela que o código inteiro lê: o que a IA pode escrever, o que o código reprova,
 * o que a pessoa pode trocar e o que o campo da tela mostra. Os limites "com foto" estão em `LIMITES_COM_FOTO`.
 */
export const CAMPOS_DO_TIPO: Record<TipoDeSlide, Partial<Record<ChaveDeCampo, LimiteDeCampo>>> = {
  "capa-foto": { rotulo: campo(3, 24, false), titulo: campo(12, 70), sub: campo(14, 90, false) },
  "capa-texto": { rotulo: campo(3, 24, false), titulo: campo(12, 70), sub: campo(14, 90, false) },
  passo: { titulo: campo(8, 48), texto: campo(30, 180) },
  item: { rotulo: campo(4, 30, false), titulo: campo(8, 48), texto: campo(30, 180) },
  "antes-depois": { titulo: campo(8, 48), antes: campo(16, 90), depois: campo(16, 90) },
  dado: { valor: campo(1, 6), unidade: campo(1, 5, false), frase: campo(18, 110), fonte: campo(12, 60), referencia: campo(14, 70) },
  "prova-fala": { citacao: campo(28, 170), quem: campo(6, 40), contexto: campo(14, 80) },
  "prova-resultado": { titulo: campo(12, 70) },
  resumo: { titulo: campo(6, 36) },
  chamada: { titulo: campo(10, 60), texto: campo(20, 120) },
  noticia: { titulo: campo(14, 90), veiculo: campo(10, 60), data: campo(5, 20) },
};

/** Os limites das listas: o resumo leva de 3 a 5 linhas de até 7 palavras; a chamada leva 2 ações de até 4 palavras. */
export const LISTAS_DO_TIPO: Partial<Record<TipoDeSlide, { chave: ChaveDeLista; minimo: number; maximo: number; palavras: number; caracteres: number }>> = {
  resumo: { chave: "linhas", minimo: 3, maximo: 5, palavras: 7, caracteres: 45 },
  chamada: { chave: "acoes", minimo: 2, maximo: 2, palavras: 4, caracteres: 30 },
};

/** Com foto no slide o texto tem menos lugar: o passo e o antes e depois ficam com limites menores (README do desenho). */
export const LIMITES_COM_FOTO: Partial<Record<TipoDeSlide, Partial<Record<ChaveDeCampo, LimiteDeCampo>>>> = {
  passo: { titulo: campo(6, 36), texto: campo(18, 110) },
  "antes-depois": { antes: campo(7, 45), depois: campo(7, 45) },
};

/** O limite de um campo de um tipo, considerando se o slide leva foto. Ausente: o campo não existe nesse tipo. */
export function limiteDoCampo(tipo: TipoDeSlide, chave: ChaveDeCampo, comFoto: boolean): LimiteDeCampo | undefined {
  return (comFoto ? LIMITES_COM_FOTO[tipo]?.[chave] : undefined) ?? CAMPOS_DO_TIPO[tipo][chave];
}

/** Tipos que exigem uma foto do cliente (sem foto, não podem ser gerados). */
export const TIPOS_COM_FOTO_OBRIGATORIA: ReadonlySet<TipoDeSlide> = new Set(["capa-foto", "prova-resultado", "noticia"]);
/** Tipos que não valem em ramo de saúde: o depoimento (fala de cliente) fica de fora até o Gustavo decidir outra coisa. Antes e depois e resultado valem, com a autorização do paciente (ver abaixo). */
export const TIPOS_PROIBIDOS_NA_SAUDE: ReadonlySet<TipoDeSlide> = new Set(["prova-fala"]);
/** Tipos cuja foto é de paciente: em ramo de saúde, pôr foto neles exige a confirmação de que a pessoa tem a autorização escrita do paciente (Resolução CFO 196/2019 para odontologia). */
export const TIPOS_COM_FOTO_DE_PACIENTE: ReadonlySet<TipoDeSlide> = new Set(["antes-depois", "prova-resultado"]);
/** A linha fixa do slide de antes e depois em ramo de saúde. Escrita por código, nunca pelo modelo. */
export const LINHA_FIXA_ANTES_DEPOIS_SAUDE = "Imagens publicadas com autorização do paciente. O resultado varia de pessoa para pessoa.";
/** A frase da recusa quando falta a autorização. */
export const FRASE_SEM_AUTORIZACAO_DO_PACIENTE = "Para usar foto de paciente, confirme que você tem a autorização dele por escrito.";
/** E65 PR 5: em saúde, o antes e depois e o resultado só aceitam foto de paciente; foto de paciente só serve a esses dois. */
export const FRASE_SO_FOTO_DE_PACIENTE = "O antes e depois e o resultado só aceitam foto de paciente, mandada com a autorização dele.";
export const FRASE_FOTO_DE_PACIENTE_SO_NO_ANTES_E_DEPOIS = "Foto de paciente só entra no antes e depois ou no resultado. Escolha uma das suas fotos do lugar ou do trabalho.";

export const ehCapa = (tipo: TipoDeSlide): boolean => tipo === "capa-foto" || tipo === "capa-texto";

/** A cor da marca quando a pessoa ainda não escolheu: o neutro escuro do produto. */
export const COR_NEUTRA = "#3a3633";

/** A legenda do post e as hashtags. */
export const LIMITE_DA_LEGENDA_PALAVRAS = 150;
/** De 3 a 5, como a regra de legenda das plataformas que o roteiro já usa (R-IG-REEL-09). */
export const HASHTAGS = { min: 3, max: 5 } as const;

/** Nunca três slides seguidos do mesmo tipo (o código confere depois da IA). */
export const MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO = 2;

/** Quais tipos aceitam foto do cliente: o antes e depois aceita duas (a do antes e a do depois). */
export const TIPOS_COM_FOTO: ReadonlySet<TipoDeSlide> = new Set(["capa-foto", "passo", "antes-depois", "prova-resultado", "noticia"]);

/** As fotos do cliente: até 9 por carrossel, só estes tipos, com teto de tamanho. Nunca imagem gerada. */
export const MAXIMO_DE_FOTOS = 9;
export const TIPOS_DE_FOTO = ["image/jpeg", "image/png", "image/webp"] as const;
export const TETO_DA_FOTO_BYTES = 6 * 1024 * 1024;

/** O tamanho de cada slide, em pixels (o formato 4:5 do carrossel do Instagram). */
export const LARGURA_DO_SLIDE = 1080;
export const ALTURA_DO_SLIDE = 1350;

export const ORIGENS_DO_CARROSSEL = ["tema", "roteiro", "noticia"] as const;
export type OrigemDoCarrossel = (typeof ORIGENS_DO_CARROSSEL)[number];

export const ESTADOS_DO_CARROSSEL = ["gerado", "editado"] as const;
export type EstadoDoCarrossel = (typeof ESTADOS_DO_CARROSSEL)[number];

/**
 * O que um slide guarda no banco: os campos do desenho (README, "Os campos de cada tipo"), só os que o tipo usa. `fotoId` e `fotoDepoisId` apontam para `carrossel_fotos`; ausentes, as fotos do carrossel são
 * distribuídas na ordem em que foram enviadas. `numero` e `de` do passo, o `rodape` e o rótulo do passo são escritos por código, nunca pela IA.
 */
export type SlideDoCarrossel = {
  tipo: TipoDeSlide;
  rotulo?: string;
  titulo: string;
  /** A linha de apoio das capas. */
  sub?: string;
  /** O texto do passo, do item e da chamada. */
  texto?: string;
  /** O passo: qual é e quantos são (por código). */
  numero?: number;
  de?: number;
  antes?: string;
  depois?: string;
  /** O dado: o valor ("42"), a unidade ("%"), a frase que explica, quem publicou e o que é com o ano. Sem fonte e ano o slide não existe. */
  valor?: string;
  unidade?: string;
  frase?: string;
  fonte?: string | null;
  referencia?: string;
  /** A fala de um cliente: a frase dita de verdade, quem disse (sem sobrenome) e o contexto. */
  citacao?: string;
  quem?: string;
  contexto?: string;
  /** O resumo (3 a 5 linhas) e a chamada (2 ações). */
  linhas?: string[];
  acoes?: string[];
  /** A capa de notícia (E66). */
  veiculo?: string;
  data?: string;
  /** Só na chamada de ramo de saúde: o lugar de uma linha opcional "Responsável técnica" (CRO). Sem campo nem tela por enquanto (falta o sim do Gustavo); o modelo só desenha se vier preenchida. */
  responsavel?: string;
  /** O ponto da foto que fica no centro do recorte (`object-position`, por exemplo "50% 30%"). */
  foco?: string;
  fotoId?: number | null;
  fotoDepoisId?: number | null;
  /** Só em antes-depois e resultado de ramo de saúde: a linha fixa escrita por código (`LINHA_FIXA_ANTES_DEPOIS_SAUDE`), que o render desenha pequena no rodapé. */
  rodape?: string;
};

/** `fotoId` ou `fotoDepoisId` com este valor: a pessoa deixou o slide SEM foto de propósito (nulo é "receba as que sobraram, na ordem"). */
export const SEM_FOTO = 0;

/** A linha fixa do slide de resultado de paciente: escrita por código. */
export const TEXTO_FIXO_DA_AUTORIZACAO = "Foto enviada pelo cliente e publicada com autorização.";
/** O fim do contexto da fala de um cliente: escrito por código, para a fala nunca sair sem a autorização dita. */
export const TEXTO_FIXO_DO_CONTEXTO_DA_FALA = "Publicado com autorização.";

/** E66, a capa de notícia: a pessoa recebe de 3 a 5 títulos para escolher; a capa é UMA imagem (quantidade 1, um slide do tipo `noticia`). */
export const TITULOS_DA_CAPA = { min: 3, max: 5 } as const;
export const QUANTIDADE_DA_CAPA = 1;
