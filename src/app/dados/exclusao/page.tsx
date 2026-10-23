import { statusDaExclusao } from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";
import { PaginaLegal } from "@/ui/componentes/PaginaLegal";

export const dynamic = "force-dynamic";

function quando(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" }).format(data);
}

/**
 * E19 PR 1: a página pública de status do pedido de exclusão de dados que a Meta manda (o `url` da resposta de `/api/meta/exclusao`). Sem sessão (`/dados` é público no
 * `middleware.ts`). Lê só pelo código de confirmação, que tem 16 caracteres sorteados; não mostra nada além de "recebido e atendido" e quantas ligações foram apagadas.
 */
export default async function ExclusaoDeDados({ searchParams }: { searchParams: Promise<{ codigo?: string }> }) {
  const { codigo } = await searchParams;
  const status = codigo ? await statusDaExclusao(codigo) : null;
  const secoes =
    codigo && status
      ? textosLigacao.exclusao.recebido(codigo, status.concluidoEm ? quando(status.concluidoEm) : "data não registrada", status.ligacoesApagadas)
      : textosLigacao.exclusao.naoEncontrado;
  return <PaginaLegal titulo={textosLigacao.exclusao.titulo} secoes={secoes} />;
}
