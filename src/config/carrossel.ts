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

/** A lista fechada de tipos de slide: a saída da IA só pode ter estes. */
export const TIPOS_DE_SLIDE = ["capa", "passo", "item", "antes_depois", "dado", "prova", "resumo", "chamada"] as const;
export type TipoDeSlide = (typeof TIPOS_DE_SLIDE)[number];

/** O limite de palavras de cada tipo de slide: o título e o corpo, contados em separado. Estourou, o verificador reprova e o render corta. */
export const LIMITE_DE_PALAVRAS: Record<TipoDeSlide, { titulo: number; corpo: number }> = {
  capa: { titulo: 12, corpo: 14 },
  passo: { titulo: 8, corpo: 30 },
  item: { titulo: 8, corpo: 30 },
  antes_depois: { titulo: 8, corpo: 30 },
  dado: { titulo: 10, corpo: 25 },
  prova: { titulo: 8, corpo: 25 },
  resumo: { titulo: 8, corpo: 35 },
  chamada: { titulo: 10, corpo: 20 },
};

/** A legenda do post e as hashtags. */
export const LIMITE_DA_LEGENDA_PALAVRAS = 150;
export const HASHTAGS = { min: 3, max: 8 } as const;

/** Nunca três slides seguidos do mesmo tipo (o código confere depois da IA). */
export const MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO = 2;

/** Quais tipos aceitam foto do cliente: o antes e depois aceita duas (a do antes e a do depois). */
export const TIPOS_COM_FOTO: ReadonlySet<TipoDeSlide> = new Set(["capa", "passo", "item", "antes_depois", "prova"]);

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

/** O que um slide guarda no banco. `fotoId` e `fotoDepoisId` apontam para `carrossel_fotos`; ausentes, as fotos do carrossel são distribuídas na ordem em que foram enviadas. */
export type SlideDoCarrossel = {
  tipo: TipoDeSlide;
  titulo: string;
  corpo: string;
  /** Só no tipo `dado`: a fonte com o ano ("Sebrae, 2025"). Nulo nos outros. */
  fonte: string | null;
  fotoId?: number | null;
  fotoDepoisId?: number | null;
};
