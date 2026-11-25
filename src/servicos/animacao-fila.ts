/**
 * E68 A2: quem põe o render do vídeo de animação na fila. Fica separado do render (`render-animacao.ts`) de propósito: o aplicativo e o worker comum importam só isto, e nunca o navegador
 * sem tela (`playwright`) que o motor usa.
 */
import { boss, FILAS, garantirBossPronto } from "@/jobs/fila";

export type PerfilDaAnimacao = "previa" | "final";
export type PayloadRenderizarAnimacao = { animacaoId: number; perfil: PerfilDaAnimacao };

/** Cada tentativa tem a própria chave, para um pedido repetido não ser descartado nem duplicado, e um `singletonKey` por animação e passo impede dois iguais ao mesmo tempo. */
export async function enfileirarRenderDaAnimacao(animacaoId: number, perfil: PerfilDaAnimacao, emSegundos = 0, tentativa: number | string = 0): Promise<void> {
  await garantirBossPronto();
  await boss().send(FILAS.renderizarAnimacao, { animacaoId, perfil } satisfies PayloadRenderizarAnimacao, {
    singletonKey: `animacao-${perfil}-${animacaoId}-${tentativa}`,
    startAfter: emSegundos,
  });
}
