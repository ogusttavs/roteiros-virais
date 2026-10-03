import { InformacoesDoAparelho } from "./InformacoesDoAparelho";

/**
 * A folha "Informações do aparelho" (H3) é ferramenta de diagnóstico para a equipe, não função de cliente (A2, item 9, achado do Gustavo no iPhone): só quem tem
 * sessão de admin a vê na Conta. O cliente comum não vê nem o botão. `ehAdmin` vem do servidor (`page.tsx`, `sessao.user.role`).
 */
export function InformacoesDoAparelhoAdmin({ ehAdmin, versaoPainel }: { ehAdmin: boolean; versaoPainel: string }) {
  if (!ehAdmin) return null;
  return <InformacoesDoAparelho versaoPainel={versaoPainel} />;
}
