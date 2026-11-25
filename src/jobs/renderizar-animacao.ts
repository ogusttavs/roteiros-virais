/**
 * Job `renderizar-animacao` (E68 A2): por evento, nunca por horário, e só no contêiner `roteiros-render` (`worker-render.ts`). `{ animacaoId, perfil }`: a prévia 540 por 960 quando a pessoa pede, o
 * final 1080 por 1920 depois que ela aprova. O trabalho todo está em `servicos/render-animacao.ts`. O resumo (que a tela de rotinas do admin mostra) tem só números e o estado.
 */
export { rodarRenderizarAnimacao, type PayloadRenderizarAnimacao } from "@/servicos/render-animacao";
