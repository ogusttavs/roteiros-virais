/**
 * Job `renderizar-edicao` (E47 PR 4): por evento, nunca por horário, e só no contêiner `roteiros-render` (`worker-render.ts`). `{ edicaoId, perfil }`: a prévia 540p quando o plano ficou pronto, o
 * vídeo final 1080p depois que a pessoa aprovou. O trabalho todo está em `servicos/render-edicao.ts`. O resumo (que a tela de rotinas do admin mostra) tem só números e o estado.
 */
export { rodarRenderizarEdicao, type PayloadRenderizarEdicao } from "@/servicos/render-edicao";
